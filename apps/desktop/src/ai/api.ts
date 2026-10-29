// The Claude API with the user's own key, for when Claude Code isn't set up
// (or they'd rather pay per use). The task's answer tool is the only tool;
// each tool call is checked like any other agent's answer, and the result
// goes back as the tool result until ClipCat says it's saved.

import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import type { ApiModelValue as ApiModel } from "@clipcat/ipc";
import type { Agent, AgentRun } from "./analyze";

/** Requests per run: the answer, a retry with the problems (or a slide's stills, and then problems), and room for a nudge if it answers in prose. */
const TURNS = 5;

const NO_KEY = "Add a Claude API key in Settings > AI editor, or pick another way to run the AI editor.";
const BAD_KEY = "The Claude API refused the key. Check it in Settings > AI editor.";

/** A readable reason for an API failure. */
export function apiError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new Error(BAD_KEY);
  if (e instanceof Anthropic.RateLimitError) return new Error("The Claude API is rate limiting this key. Try again in a minute.");
  if (e instanceof Anthropic.APIError && e.status) return new Error(`The Claude API returned ${e.status}: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new Error("Couldn't reach the Claude API. Check the connection.");
  return e instanceof Error ? e : new Error(String(e));
}

/** The answer without nulls, so the shared schemas (which use optional fields) read it. */
const dropNulls = (input: unknown): unknown => JSON.parse(JSON.stringify(input), (_k, v: unknown) => (v === null ? undefined : v));

/** Pictures as image blocks. */
const jpegs = (paths: string[] = []) =>
  Promise.all(
    paths.map(async (path): Promise<Anthropic.Beta.BetaImageBlockParam> => ({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: (await readFile(path)).toString("base64") },
    })),
  );

/** Checks a key with one cheap call; throws a readable error if it doesn't work. */
export async function verifyKey(key: string, model: ApiModel, client = new Anthropic({ apiKey: key, maxRetries: 1 })): Promise<void> {
  try {
    await client.models.retrieve(model);
  } catch (e) {
    throw apiError(e);
  }
}

export function apiAgent(options: { key: () => Promise<string | null>; model: () => Promise<ApiModel>; client?: (key: string) => Anthropic }): Agent {
  return {
    label: "Claude API",
    run: async (run: AgentRun) => {
      const key = await options.key();
      if (!key) throw new Error(NO_KEY);
      const model = await options.model();
      const client = options.client?.(key) ?? new Anthropic({ apiKey: key });
      const tool: Anthropic.Beta.BetaTool = {
        name: run.task.tool,
        description: run.task.description,
        input_schema: run.task.jsonSchema as Anthropic.Beta.BetaTool.InputSchema,
        strict: true,
      };
      const pictures = await jpegs(run.images);
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        { role: "user", content: pictures.length > 0 ? [...pictures, { type: "text", text: run.prompt }] : run.prompt },
      ];

      for (let turn = 1; turn <= TURNS; turn++) {
        run.activity(turn > 1 ? "Claude is fixing its answer" : pictures.length > 0 ? "Claude is looking at your media" : "Claude is reading the transcript");
        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await client.beta.messages
            .stream(
              {
                model,
                max_tokens: 64000,
                system: `${run.system}\n\n${run.task.toolAnswer}`,
                tools: [tool],
                messages,
                output_config: { effort: "high" },
                // The stable prefix (tools, system, transcript) is cached, so a retry costs little.
                cache_control: { type: "ephemeral" },
                // A declined request is re-run on the recommended fallback model instead of failing.
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default",
              },
              { signal: run.signal },
            )
            .finalMessage();
        } catch (e) {
          if (run.signal.aborted) throw new Error("cancelled");
          throw apiError(e);
        }
        if (response.stop_reason === "refusal") throw new Error("Claude declined to edit this transcript.");
        if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was too long to finish.");

        messages.push({ role: "assistant", content: response.content });
        const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (calls.length === 0) {
          messages.push({ role: "user", content: `Answer by calling ${run.task.tool}.` });
          continue;
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        let done = false;
        for (const call of calls) {
          if (call.name !== run.task.tool || done) {
            results.push({ type: "tool_result", tool_use_id: call.id, content: "Not run.", is_error: true });
            continue;
          }
          run.activity("Checking Claude's answer");
          const reply = await run.submit(dropNulls(call.input));
          const stills = await jpegs(reply.images);
          results.push({ type: "tool_result", tool_use_id: call.id, content: stills.length > 0 ? [{ type: "text", text: reply.text }, ...stills] : reply.text });
          done = reply.done;
        }
        if (done) return;
        messages.push({ role: "user", content: results });
      }
    },
  };
}
