import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AgentRun, SubmitReply } from "./analyze";
import { apiAgent, apiError, verifyKey } from "./api";
import { ANALYSIS_TASK, EDITOR_PROMPT } from "./prompt";

type Params = Anthropic.Beta.MessageCreateParams;

/** A client whose responses are scripted, recording every request. */
function fakeClient(responses: Partial<Anthropic.Beta.BetaMessage>[]) {
  const requests: Params[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: Params) => {
          // The loop keeps appending to one array; copy what was sent this time.
          requests.push(structuredClone(params));
          const next = responses.shift();
          return { finalMessage: async () => (next instanceof Error ? Promise.reject(next) : next) };
        },
      },
    },
    models: { retrieve: async () => ({}) },
  } as unknown as Anthropic;
  return { client, requests };
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

const call = (id: string, input: unknown) => ({
  stop_reason: "tool_use" as const,
  content: [{ type: "tool_use" as const, id, name: "submit_analysis", input, caller: { type: "direct" as const } }],
});

describe("Claude API agent", () => {
  it("answers through the task's tool, gets the problems back and stops once saved", async () => {
    const bad = { proposals: [{ type: "cleanup", from: 0, to: 99, keepFrom: null, keepTo: null, reason: "x", confidence: 1 }], suggestedTitle: "" };
    const { client, requests } = fakeClient([call("t1", bad), call("t2", { proposals: [], suggestedTitle: "T" })] as never);
    const { r, seen } = run([
      { text: "proposal 0: word indices out of range", done: false },
      { text: "Saved 0 proposals. Stop here.", done: true },
    ]);
    await apiAgent({ key: async () => "sk-ant-x", model: async () => "claude-opus-5-5", client: () => client }).run(r);

    expect(seen[0]).toEqual({ proposals: [{ type: "cleanup", from: 0, to: 99, reason: "x", confidence: 1 }], suggestedTitle: "" });
    expect(requests).toHaveLength(2);
    const first = requests[0]!;
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.tools).toEqual([expect.objectContaining({ name: "submit_analysis", strict: true })]);
    expect(first.tool_choice).toBeUndefined();
    expect(first.system).toContain("Call submit_analysis once");
    expect(first.fallbacks).toBe("default");
    const retry = requests[1]!.messages.at(-1)!;
    expect(retry.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "proposal 0: word indices out of range" }]);
  });

  it("shows the pictures before the prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clipcat-api-"));
    try {
      await writeFile(join(dir, "f.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
      const { client, requests } = fakeClient([call("t1", { proposals: [], suggestedTitle: "" })] as never);
      const { r } = run([{ text: "Saved.", done: true }]);
      await apiAgent({ key: async () => "sk-ant-x", model: async () => "claude-opus-5-5", client: () => client }).run({ ...r, images: [join(dir, "f.jpg")] });
      expect(requests[0]!.messages[0]!.content).toEqual([
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/" } },
        { type: "text", text: "TRANSCRIPT" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("nudges an answer written as prose", async () => {
    const { client, requests } = fakeClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "Here are my cuts…", citations: null }] },
      call("t1", { proposals: [], suggestedTitle: "" }),
    ] as never);
    const { r } = run([{ text: "Saved.", done: true }]);
    await apiAgent({ key: async () => "k", model: async () => "claude-haiku-5-5", client: () => client }).run(r);
    expect(requests[1]!.messages.at(-1)).toEqual({ role: "user", content: "Answer by calling submit_analysis." });
  });

  it("says what to do without a key, with a refused key, or after a refusal", async () => {
    const { r } = run([]);
    await expect(apiAgent({ key: async () => null, model: async () => "claude-opus-5-5" }).run(r)).rejects.toThrow(/Add a Claude API key/);

    const unauthorized = Anthropic.APIError.generate(401, { error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid", new Headers());
    const { client } = fakeClient([unauthorized] as never);
    await expect(apiAgent({ key: async () => "k", model: async () => "claude-opus-5-5", client: () => client }).run(run([]).r)).rejects.toThrow(
      /refused the key/,
    );

    const declined = fakeClient([{ stop_reason: "refusal", content: [] }] as never);
    await expect(apiAgent({ key: async () => "k", model: async () => "claude-opus-5-5", client: () => declined.client }).run(run([]).r)).rejects.toThrow(
      /declined/,
    );
  });

  it("checks a key before keeping it", async () => {
    const ok = fakeClient([]).client;
    await expect(verifyKey("sk-ant-x", "claude-opus-5-5", ok)).resolves.toBeUndefined();
    const bad = { models: { retrieve: async () => Promise.reject(Anthropic.APIError.generate(401, {}, "no", new Headers())) } } as unknown as Anthropic;
    await expect(verifyKey("sk-ant-x", "claude-opus-5-5", bad)).rejects.toThrow(/refused the key/);
    expect(apiError(new Anthropic.APIConnectionError({ message: "down" })).message).toMatch(/Couldn't reach/);
  });
});
