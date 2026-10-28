import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOUND_EFFECTS } from "@clipcat/core";
import { describe, expect, it } from "vitest";
import { soundFile } from "./library";

const SFX = join(__dirname, "..", "..", "resources", "sfx");

describe("the shipped sound effects", () => {
  it("has a 48 kHz stereo file for every effect, long enough to reach its hit", () => {
    for (const e of SOUND_EFFECTS) {
      const wav = readFileSync(soundFile(SFX, e.id));
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.readUInt16LE(22)).toBe(2);
      expect(wav.readUInt32LE(24)).toBe(48000);
      const seconds = wav.readUInt32LE(40) / (48000 * 4);
      expect(seconds, e.id).toBeGreaterThan(0.05);
      expect(seconds, e.id).toBeGreaterThanOrEqual(e.hit);
    }
  });
});
