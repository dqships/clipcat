// Transcript corrections: the agent names words speech recognition got wrong
// (names, product names, jargon, homophones) by their number and gives the
// right spelling. Like proposals, nothing is trusted until it is checked; a
// correction changes a word's text only, never its timing or the edit.

import { z } from "zod";
import type { Word } from "./project";

export const AgentCorrections = z.object({
  corrections: z
    .array(
      z.object({
        index: z.number().int(),
        text: z.string().min(1).max(60),
      }),
    )
    .max(2000),
});

export type AgentCorrections = z.infer<typeof AgentCorrections>;

/**
 * Checks corrections against `words` (the numbered transcript). Each must name
 * a real word and replace it with one word; a correction that changes nothing
 * is skipped, not an error. Returns the new text per word id.
 */
export function validateCorrections(input: AgentCorrections, words: Word[]): { fixes: Map<string, string>; errors: string[] } {
  const fixes = new Map<string, string>();
  const errors: string[] = [];
  input.corrections.forEach((c, i) => {
    const where = `correction ${i} ([${c.index}] → "${c.text}")`;
    const word = words[c.index];
    const text = c.text.trim();
    if (!word) return void errors.push(`${where}: there is no word ${c.index}; indices run 0..${words.length - 1}`);
    if (/\s/.test(text)) return void errors.push(`${where}: give one word per index, without spaces`);
    if (fixes.has(word.id)) return void errors.push(`${where}: word ${c.index} is corrected twice`);
    if (text !== word.text) fixes.set(word.id, text);
  });
  return { fixes, errors };
}

/** The transcript with `fixes` applied, keeping what was first heard. */
export function applyCorrections(transcript: Word[], fixes: Map<string, string>): Word[] {
  return transcript.map((w) => {
    const text = fixes.get(w.id);
    return text === undefined ? w : { ...w, text, heard: w.heard ?? w.text };
  });
}
