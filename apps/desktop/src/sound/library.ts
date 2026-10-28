// Where ClipCat's sound effects are on disk: resources/sfx, made by
// scripts/make-sfx.mjs. What each one is lives in @clipcat/core (SOUND_EFFECTS).

import { join } from "node:path";

/** Where an effect's file is, in the folder the library ships in. */
export const soundFile = (dir: string, id: string) => join(dir, `${id}.wav`);
