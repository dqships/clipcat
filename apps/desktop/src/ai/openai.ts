// OpenAI and OpenRouter with the user's own key, for running the AI editor
// on GPT or on any model OpenRouter serves. Like the Claude API option, the
// task's answer tool is the only tool, each call is checked like any other
// agent's answer, and the result goes back as the tool's output until
// ClipCat says it's saved. OpenAI's newer models take tools only through the
// Responses API; OpenRouter speaks Chat Completions for every model, so each
// gets its own request shape around the same loop.

import { readFile } from "node:fs/promises";
import type { KeyedProviderValue as Provider } from "@clipcat/ipc";
import type { Agent, AgentRun } from "./analyze";

/** Requests per run: the answer, a retry with the problems (or a slide's stills, and then problems), and room for a nudge if it answers in prose. */
const TURNS = 5;

const OPENAI = "https://api.openai.com/v1";
const OPENROUTER = "https://openrouter.ai/api/v1";

/** How long checking a key or listing models may take, so a dead connection doesn't hold up Settings. */
const QUICK_MS = 15_000;

export const PROVIDER_NAME: Record<Provider, string> = { openai: "OpenAI", openrouter: "OpenRouter" };

type Fetch = typeof fetch;

/** A failed request, with the provider's own message when it sent one. */
export class ProviderError extends Error {
  constructor(
    readonly provider: Provider,
    readonly status: number,
    detail: string,
  ) {
    const name = PROVIDER_NAME[provider];
    super(
      status === 401 || status === 403
        ? `${name} refused the key. Check it in Settings > AI editor.`
        : status === 429
          ? `${name} is rate limiting this key, or it's out of credit. Try again in a minute.`
          : `${name} returned ${status}${detail ? `: ${detail}` : ""}`,
    );
  }
}

/** Parses a response, turning an error status into a readable error. */
async function body<T>(provider: Provider, response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      detail = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? detail);
    } catch {
      // Not JSON: the start of the text will do.
    }
    throw new ProviderError(provider, response.status, detail.trim());
  }
  return JSON.parse(text) as T;
}

async function call<T>(provider: Provider, fetcher: Fetch, path: string, key: string | null, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${provider === "openai" ? OPENAI : OPENROUTER}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        // OpenRouter shows these on its activity page, so a run there says where it came from.
        ...(provider === "openrouter" ? { "HTTP-Referer": "https://clipcat.followusai.com", "X-Title": "ClipCat" } : {}),
        ...init.headers,
      },
    });
  } catch (e) {
    // A cancelled run stays cancelled; a timeout reads like any other dead connection.
    if (init.signal?.aborted && (init.signal.reason as Error | undefined)?.name !== "TimeoutError") throw e;
    throw new Error(`Couldn't reach ${PROVIDER_NAME[provider]}. Check the connection.`);
  }
  return body<T>(provider, response);
}

/** Checks a key with one cheap call; throws a readable error if it doesn't work. */
export async function verifyProviderKey(provider: Provider, key: string, fetcher: Fetch = fetch): Promise<void> {
  // OpenRouter's model list is public, so its key is checked against the key endpoint instead.
  await call(provider, fetcher, provider === "openai" ? "/models" : "/key", key, { signal: AbortSignal.timeout(QUICK_MS) });
}

export type ModelChoice = { id: string; label: string };

/** OpenAI's chat models, newest family first: not audio, image, embedding or moderation models, which can't edit. */
export function openAiChoices(ids: string[]): ModelChoice[] {
  const chat = ids.filter((id) => /^(gpt-|o\d)/.test(id) && !/(audio|realtime|image|tts|transcribe|search|embedding|moderation|instruct|-\d{4}-\d{2}-\d{2}$)/.test(id));
  const version = (id: string) => Number(/^gpt-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? /^o(\d+)/.exec(id)?.[1] ?? 0);
  // Bigger version first; at one version, the full model before mini and nano.
  const size = (id: string) => (/nano/.test(id) ? 2 : /mini/.test(id) ? 1 : 0);
  return [...new Set(chat)]
    .sort((a, b) => version(b) - version(a) || size(a) - size(b) || a.localeCompare(b))
    .map((id) => ({ id, label: id }));
}

type OpenRouterModel = { id: string; name?: string; supported_parameters?: string[] };

/** OpenRouter's models that take tools, by name. */
export function openRouterChoices(models: OpenRouterModel[]): ModelChoice[] {
  return models
    .filter((m) => m.supported_parameters?.includes("tools") ?? false)
    .map((m) => ({ id: m.id, label: m.name ? `${m.name} (${m.id})` : m.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The models a key can run the AI editor on. */
export async function listModels(provider: Provider, key: string, fetcher: Fetch = fetch): Promise<ModelChoice[]> {
  if (provider === "openai") {
    const { data } = await call<{ data: { id: string }[] }>(provider, fetcher, "/models", key, { signal: AbortSignal.timeout(QUICK_MS) });
    return openAiChoices(data.map((m) => m.id));
  }
  const { data } = await call<{ data: OpenRouterModel[] }>(provider, fetcher, "/models?supported_parameters=tools", key, { signal: AbortSignal.timeout(QUICK_MS) });
  return openRouterChoices(data);
}

/** The answer without nulls, so the shared schemas (which use optional fields) read it. */
const dropNulls = (input: unknown): unknown => JSON.parse(JSON.stringify(input), (_k, v: unknown) => (v === null ? undefined : v));

/** Pictures as data URLs. */
const dataUrls = (paths: string[] = []) => Promise.all(paths.map(async (path) => `data:image/jpeg;base64,${(await readFile(path)).toString("base64")}`));

/** The arguments a model called the tool with, or the parse error to hand back. */
function parseArguments(text: string): { input: unknown } | { error: string } {
  try {
    return { input: JSON.parse(text) };
  } catch (e) {
    return { error: `The arguments weren't valid JSON: ${(e as Error).message}` };
  }
}

/** One tool call from the model, whichever API it came from. */
type Call = { id: string; name: string; arguments: string };

/** A conversation with one provider: send the next turn, get back its calls and any text. */
type Transport = {
  turn: () => Promise<{ calls: Call[]; refused: boolean; truncated: boolean }>;
  reply: (results: { id: string; text: string; images: string[] }[]) => void;
  nudge: (text: string) => void;
};

type Options = { key: string; model: string; fetch?: Fetch };

/** OpenAI's Responses API, which its newer models need for tools. */
function responses(run: AgentRun, pictures: string[], options: Options & { fetcher: Fetch }): Transport {
  const input: unknown[] = [
    {
      role: "user",
      content: [...pictures.map((url) => ({ type: "input_image", image_url: url })), { type: "input_text", text: run.prompt }],
    },
  ];
  const tool = { type: "function", name: run.task.tool, description: run.task.description, parameters: run.task.jsonSchema, strict: true };
  type Item = { type: string; call_id?: string; name?: string; arguments?: string; content?: { type: string }[] };
  return {
    turn: async () => {
      const response = await call<{ output: Item[]; status?: string; incomplete_details?: { reason?: string } | null }>(
        "openai",
        options.fetcher,
        "/responses",
        options.key,
        {
          method: "POST",
          signal: run.signal,
          body: JSON.stringify({
            model: options.model,
            instructions: `${run.system}\n\n${run.task.toolAnswer}`,
            input,
            tools: [tool],
            tool_choice: "required",
            // Nothing is kept on OpenAI's side, so reasoning comes back encrypted for the next turn to carry.
            store: false,
            include: ["reasoning.encrypted_content"],
          }),
        },
      );
      input.push(...response.output);
      const calls = response.output
        .filter((item) => item.type === "function_call")
        .map((item) => ({ id: item.call_id ?? "", name: item.name ?? "", arguments: item.arguments ?? "" }));
      const refused = response.output.some((item) => item.content?.some((c) => c.type === "refusal"));
      return { calls, refused, truncated: response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens" };
    },
    reply: (results) => {
      for (const r of results) {
        input.push({
          type: "function_call_output",
          call_id: r.id,
          output: r.images.length > 0 ? [{ type: "input_text", text: r.text }, ...r.images.map((url) => ({ type: "input_image", image_url: url }))] : r.text,
        });
      }
    },
    nudge: (text) => input.push({ role: "user", content: text }),
  };
}

/** OpenRouter's Chat Completions, which every model there speaks. */
function chat(run: AgentRun, pictures: string[], options: Options & { fetcher: Fetch }): Transport {
  type Message = Record<string, unknown>;
  const messages: Message[] = [
    { role: "system", content: `${run.system}\n\n${run.task.toolAnswer}` },
    {
      role: "user",
      content: pictures.length > 0 ? [...pictures.map((url) => ({ type: "image_url", image_url: { url } })), { type: "text", text: run.prompt }] : run.prompt,
    },
  ];
  const tool = { type: "function", function: { name: run.task.tool, description: run.task.description, parameters: run.task.jsonSchema, strict: true } };
  type Choice = { finish_reason?: string; message: { content?: string | null; refusal?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } };
  return {
    turn: async () => {
      const response = await call<{ choices: Choice[] }>("openrouter", options.fetcher, "/chat/completions", options.key, {
        method: "POST",
        signal: run.signal,
        body: JSON.stringify({
          model: options.model,
          messages,
          tools: [tool],
          tool_choice: { type: "function", function: { name: run.task.tool } },
          // Send the request only to providers that honour tools, rather than one that ignores them.
          provider: { require_parameters: true },
        }),
      });
      const choice = response.choices[0];
      if (!choice) throw new Error("OpenRouter sent back an empty answer.");
      messages.push({ role: "assistant", content: choice.message.content ?? null, tool_calls: choice.message.tool_calls });
      const calls = (choice.message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));
      return { calls, refused: Boolean(choice.message.refusal), truncated: choice.finish_reason === "length" };
    },
    reply: (results) => {
      for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.text });
      // Chat Completions can't put pictures in a tool result, so the stills follow as a user message.
      const stills = results.flatMap((r) => r.images);
      if (stills.length > 0) messages.push({ role: "user", content: stills.map((url) => ({ type: "image_url", image_url: { url } })) });
    },
    nudge: (text) => messages.push({ role: "user", content: text }),
  };
}

export function providerAgent(provider: Provider, options: { key: () => Promise<string | null>; model: () => Promise<string | null>; fetch?: Fetch }): Agent {
  const name = PROVIDER_NAME[provider];
  return {
    label: name,
    run: async (run: AgentRun) => {
      const key = await options.key();
      if (!key) throw new Error(`Add an ${name} key in Settings > AI editor, or pick another way to run the AI editor.`);
      const model = await options.model();
      if (!model) throw new Error(`Pick an ${name} model in Settings > AI editor.`);
      const fetcher = options.fetch ?? fetch;
      const pictures = await dataUrls(run.images);
      const talk = (provider === "openai" ? responses : chat)(run, pictures, { key, model, fetcher });

      for (let turn = 1; turn <= TURNS; turn++) {
        run.activity(turn > 1 ? `${name} is fixing its answer` : pictures.length > 0 ? `${name} is looking at your media` : `${name} is reading the transcript`);
        let answer: Awaited<ReturnType<Transport["turn"]>>;
        try {
          answer = await talk.turn();
        } catch (e) {
          if (run.signal.aborted) throw new Error("cancelled");
          throw e;
        }
        if (answer.refused) throw new Error(`${name} declined to edit this transcript.`);
        if (answer.truncated && answer.calls.length === 0) throw new Error(`${name}'s answer was too long to finish.`);
        if (answer.calls.length === 0) {
          talk.nudge(`Answer by calling ${run.task.tool}.`);
          continue;
        }
        const results: { id: string; text: string; images: string[] }[] = [];
        let done = false;
        for (const c of answer.calls) {
          if (c.name !== run.task.tool || done) {
            results.push({ id: c.id, text: "Not run.", images: [] });
            continue;
          }
          const parsed = parseArguments(c.arguments);
          if ("error" in parsed) {
            results.push({ id: c.id, text: parsed.error, images: [] });
            continue;
          }
          run.activity(`Checking ${name}'s answer`);
          const reply = await run.submit(dropNulls(parsed.input));
          results.push({ id: c.id, text: reply.text, images: await dataUrls(reply.images) });
          done = reply.done;
        }
        if (done) return;
        talk.reply(results);
      }
    },
  };
}
