import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRun, SubmitReply } from "./analyze";
import { listModels, openAiChoices, openRouterChoices, providerAgent, verifyProviderKey } from "./openai";
import { ANALYSIS_TASK, EDITOR_PROMPT } from "./prompt";

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> | null };

/** A fetch whose answers are scripted, recording every request (bodies copied, since the loop keeps appending). */
function fakeFetch(answers: (object | { status: number; body: object })[]) {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    sent.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null });
    const next = answers.shift()!;
    const [status, body] = "status" in next && "body" in next ? [next.status as number, next.body] : [200, next];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetcher, sent };
}

function run(replies: SubmitReply[]) {
  const seen: unknown[] = [];
  const r: AgentRun = {
    task: ANALYSIS_TASK,
    system: EDITOR_PROMPT,
    prompt: "TRANSCRIPT",
    submit: async (input) => {
      seen.push(input);
      return replies[seen.length - 1]!;
    },
    activity: () => {},
    signal: new AbortController().signal,
  };
  return { r, seen };
}

const bad = { proposals: [{ type: "cleanup", from: 0, to: 99, keepFrom: null, keepTo: null, reason: "x", confidence: 1 }], suggestedTitle: "" };
const good = { proposals: [], suggestedTitle: "T" };

const responsesCall = (id: string, input: unknown) => ({
  status: "completed",
  output: [{ type: "function_call", call_id: id, name: "submit_analysis", arguments: JSON.stringify(input) }],
});

const chatCall = (id: string, input: unknown) => ({
  choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id, type: "function", function: { name: "submit_analysis", arguments: JSON.stringify(input) } }] } }],
});

describe("OpenAI agent", () => {
  it("answers through the task's tool on the Responses API, gets the problems back and stops once saved", async () => {
    const { fetcher, sent } = fakeFetch([responsesCall("c1", bad), responsesCall("c2", good)]);
    const { r, seen } = run([
      { text: "proposal 0: word indices out of range", done: false },
      { text: "Saved 0 proposals. Stop here.", done: true },
    ]);
    await providerAgent("openai", { key: async () => "sk-x", model: async () => "gpt-6.1-sol", fetch: fetcher }).run(r);

    expect(seen[0]).toEqual({ proposals: [{ type: "cleanup", from: 0, to: 99, reason: "x", confidence: 1 }], suggestedTitle: "" });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.url).toBe("https://api.openai.com/v1/responses");
    expect(sent[0]!.headers.Authorization).toBe("Bearer sk-x");
    const first = sent[0]!.body!;
    expect(first.model).toBe("gpt-6.1-sol");
    expect(first.tools).toEqual([expect.objectContaining({ type: "function", name: "submit_analysis", strict: true, parameters: ANALYSIS_TASK.jsonSchema })]);
    expect(first.instructions).toContain("Call submit_analysis once");
    // Nothing is stored at OpenAI, so reasoning has to travel with the conversation.
    expect(first).toMatchObject({ store: false, include: ["reasoning.encrypted_content"], tool_choice: "required" });
    expect((sent[1]!.body!.input as unknown[]).at(-1)).toEqual({ type: "function_call_output", call_id: "c1", output: "proposal 0: word indices out of range" });
  });

  it("shows the pictures before the prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clipcat-openai-"));
    try {
      await writeFile(join(dir, "f.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
      const { fetcher, sent } = fakeFetch([responsesCall("c1", good)]);
      const { r } = run([{ text: "Saved.", done: true }]);
      await providerAgent("openai", { key: async () => "k", model: async () => "gpt-6.1-sol", fetch: fetcher }).run({ ...r, images: [join(dir, "f.jpg")] });
      expect((sent[0]!.body!.input as { content: unknown }[])[0]!.content).toEqual([
        { type: "input_image", image_url: "data:image/jpeg;base64,/9j/" },
        { type: "input_text", text: "TRANSCRIPT" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops asking for encrypted reasoning when an older model refuses it", async () => {
    const refused = { status: 400, body: { error: { message: "Encrypted content is not supported with this model." } } };
    const { fetcher, sent } = fakeFetch([refused, responsesCall("c1", good)]);
    await providerAgent("openai", { key: async () => "k", model: async () => "gpt-4.1", fetch: fetcher }).run(run([{ text: "Saved.", done: true }]).r);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body!.include).toEqual(["reasoning.encrypted_content"]);
    expect(sent[1]!.body!.include).toBeUndefined();
  });

  it("hands back arguments that aren't JSON instead of failing the run", async () => {
    const broken = { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "submit_analysis", arguments: "{oops" }] };
    const { fetcher, sent } = fakeFetch([broken, responsesCall("c2", good)]);
    const { r, seen } = run([{ text: "Saved.", done: true }]);
    await providerAgent("openai", { key: async () => "k", model: async () => "gpt-6.1-sol", fetch: fetcher }).run(r);
    expect(seen).toEqual([good]);
    expect((sent[1]!.body!.input as { output?: string }[]).at(-1)!.output).toMatch(/weren't valid JSON/);
  });

  it("says what to do without a key or a model, with a refused key, or after a refusal", async () => {
    await expect(providerAgent("openai", { key: async () => null, model: async () => "m" }).run(run([]).r)).rejects.toThrow(/Add an OpenAI key in Settings/);
    await expect(providerAgent("openrouter", { key: async () => "k", model: async () => null }).run(run([]).r)).rejects.toThrow(/Pick an OpenRouter model/);

    const refusedKey = fakeFetch([{ status: 401, body: { error: { message: "Incorrect API key provided" } } }]);
    await expect(providerAgent("openai", { key: async () => "k", model: async () => "m", fetch: refusedKey.fetcher }).run(run([]).r)).rejects.toThrow(
      /OpenAI refused the key/,
    );

    const declined = fakeFetch([{ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }]);
    await expect(providerAgent("openai", { key: async () => "k", model: async () => "m", fetch: declined.fetcher }).run(run([]).r)).rejects.toThrow(/declined/);

    const failing = fakeFetch([{ status: 400, body: { error: { message: "Model not found" } } }]);
    await expect(providerAgent("openai", { key: async () => "k", model: async () => "m", fetch: failing.fetcher }).run(run([]).r)).rejects.toThrow(
      "OpenAI returned 400: Model not found",
    );
  });
});

describe("OpenRouter agent", () => {
  it("uses Chat Completions with the tool forced, and sends stills after the tool result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clipcat-openrouter-"));
    try {
      await writeFile(join(dir, "s.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
      const { fetcher, sent } = fakeFetch([chatCall("t1", bad), chatCall("t2", good)]);
      const { r } = run([
        { text: "Here's the slide.", done: false, images: [join(dir, "s.jpg")] },
        { text: "Saved.", done: true },
      ]);
      await providerAgent("openrouter", { key: async () => "or-k", model: async () => "anthropic/claude-sonnet-5.5", fetch: fetcher }).run(r);

      expect(sent[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(sent[0]!.headers["X-Title"]).toBe("ClipCat");
      const first = sent[0]!.body!;
      expect(first.model).toBe("anthropic/claude-sonnet-5.5");
      expect(first.tool_choice).toEqual({ type: "function", function: { name: "submit_analysis" } });
      expect(first.provider).toEqual({ require_parameters: true });
      expect((first.messages as { role: string }[])[0]!.role).toBe("system");
      const retry = (sent[1]!.body!.messages as unknown[]).slice(-2);
      expect(retry).toEqual([
        { role: "tool", tool_call_id: "t1", content: "Here's the slide." },
        { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } }] },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("nudges an answer written as prose", async () => {
    const prose = { choices: [{ finish_reason: "stop", message: { content: "Here are my cuts…" } }] };
    const { fetcher, sent } = fakeFetch([prose, chatCall("t1", good)]);
    await providerAgent("openrouter", { key: async () => "k", model: async () => "m/x", fetch: fetcher }).run(run([{ text: "Saved.", done: true }]).r);
    expect((sent[1]!.body!.messages as unknown[]).at(-1)).toEqual({ role: "user", content: "Answer by calling submit_analysis." });
  });
});

describe("keys and model lists", () => {
  it("checks a key against an endpoint that needs it", async () => {
    const openai = fakeFetch([{ data: [] }]);
    await verifyProviderKey("openai", "sk-x", openai.fetcher);
    expect(openai.sent[0]!.url).toBe("https://api.openai.com/v1/models");
    const openrouter = fakeFetch([{ status: 401, body: { error: { message: "No auth credentials found" } } }]);
    await expect(verifyProviderKey("openrouter", "or-x", openrouter.fetcher)).rejects.toThrow(/OpenRouter refused the key/);
    expect(openrouter.sent[0]!.url).toBe("https://openrouter.ai/api/v1/key");
    const down = (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    await expect(verifyProviderKey("openai", "sk-x", down)).rejects.toThrow("Couldn't reach OpenAI. Check the connection.");
  });

  it("lists OpenAI's chat models, newest and biggest first", () => {
    const ids = ["gpt-5.5-mini", "text-embedding-3-large", "o1-preview", "gpt-6.1-sol", "gpt-4o-audio-preview", "gpt-6.1-sol-2026-09-01", "dall-e-3", "gpt-5.5", "o4-mini", "gpt-6.1-mini", "gpt-5.5-pro", "whisper-1", "gpt-image-2"];
    expect(openAiChoices(ids).map((c) => c.id)).toEqual(["gpt-6.1-sol", "gpt-6.1-mini", "gpt-5.5", "gpt-5.5-mini", "o4-mini"]);
  });

  it("lists only OpenRouter models that take tools", async () => {
    const models = [
      { id: "z/one", name: "Zed One", supported_parameters: ["tools", "tool_choice"] },
      { id: "a/two", name: "Alpha Two", supported_parameters: ["temperature"] },
      { id: "a/three", name: "Alpha Three", supported_parameters: ["tools"], architecture: { input_modalities: ["text"] } },
    ];
    expect(openRouterChoices(models)).toEqual([
      { id: "a/three", label: "Alpha Three (a/three), text only" },
      { id: "z/one", label: "Zed One (z/one)" },
    ]);
    const { fetcher, sent } = fakeFetch([{ data: models }]);
    expect(await listModels("openrouter", "k", fetcher)).toHaveLength(2);
    expect(sent[0]!.url).toBe("https://openrouter.ai/api/v1/models?supported_parameters=tools");
  });
});
