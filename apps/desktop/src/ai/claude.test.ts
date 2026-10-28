import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudePrompt, isAuthFailure, parseLoggedIn } from "./claude";

describe("claude", () => {
  it("reads `claude auth status`", () => {
    expect(parseLoggedIn('{ "loggedIn": false, "authMethod": "none" }')).toBe(false);
    expect(parseLoggedIn('Warning: x\n{"loggedIn":true}')).toBe(true);
    expect(parseLoggedIn("unknown command 'auth'")).toBeNull();
    expect(parseLoggedIn(null)).toBeNull();
  });

  it("recognises a signed-out CLI", () => {
    expect(isAuthFailure("Failed to authenticate. API Error: 401")).toBe(true);
    expect(isAuthFailure("OAuth token has expired")).toBe(true);
    expect(isAuthFailure("max turns reached")).toBe(false);
  });

  it("sends plain text, or one message with the pictures first", async () => {
    expect(await claudePrompt("hi")).toBe("hi");
    const dir = await mkdtemp(join(tmpdir(), "clipcat-claude-"));
    try {
      await writeFile(join(dir, "f.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
      const prompt = await claudePrompt("look", [join(dir, "f.jpg")]);
      const messages = [];
      for await (const m of prompt as AsyncIterable<unknown>) messages.push(m);
      expect(messages).toEqual([
        {
          type: "user",
          parent_tool_use_id: null,
          message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/" } }, { type: "text", text: "look" }] },
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
