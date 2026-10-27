import { describe, expect, it } from "vitest";
import { isAuthFailure, parseLoggedIn } from "./claude";

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
});
