import { describe, expect, it } from "vitest";
import { PARAKEET_LANGUAGES, SPEECH_LANGUAGES, isSpeechLanguage, languageName, languagesByName } from "./languages";

describe("speech languages", () => {
  it("knows whisper's 100 languages, Parakeet's 25 among them", () => {
    expect(SPEECH_LANGUAGES).toHaveLength(100);
    expect(new Set(SPEECH_LANGUAGES.map(([code]) => code)).size).toBe(100);
    expect(PARAKEET_LANGUAGES.size).toBe(25);
    for (const code of PARAKEET_LANGUAGES) expect(isSpeechLanguage(code)).toBe(true);
  });

  it("names a language, accepts auto, and sorts by name", () => {
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("auto")).toBe("Detect automatically");
    expect(isSpeechLanguage("auto")).toBe(true);
    expect(isSpeechLanguage("xx")).toBe(false);
    expect(languagesByName()[0]).toEqual({ code: "af", name: "Afrikaans" });
  });

  it("matches the list on the website", async () => {
    // The site is deployed on its own, so it keeps a copy of the list.
    const path = new URL("../../../apps/site/lib/content.mjs", import.meta.url).href;
    const site = (await import(/* @vite-ignore */ path)) as { SPEECH_LANGUAGES: [string, string][]; PARAKEET_CODES: string[] };
    expect(site.SPEECH_LANGUAGES).toEqual(SPEECH_LANGUAGES.map(([code, name]) => [code, name]));
    expect([...site.PARAKEET_CODES].sort()).toEqual([...PARAKEET_LANGUAGES].sort());
  });
});
