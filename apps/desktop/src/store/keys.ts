// The user's Claude API key, kept out of the settings file: encrypted with the
// operating system's keychain (Electron's safeStorage) and never sent to the
// window, which only learns whether a key is saved.

import { readFile, rm } from "node:fs/promises";
import { writeFileAtomic } from "../atomic";

export type Cipher = {
  available: () => boolean;
  encrypt: (plain: string) => Buffer;
  decrypt: (data: Buffer) => string;
};

export class KeyStore {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  /** The saved key, or null when there is none or it can't be read back (another machine's keychain). */
  async get(): Promise<string | null> {
    try {
      return this.cipher.decrypt(Buffer.from(await readFile(this.file, "utf8"), "base64")) || null;
    } catch {
      return null;
    }
  }

  async set(key: string | null): Promise<void> {
    if (!key) return rm(this.file, { force: true });
    if (!this.cipher.available()) throw new Error("This computer's keychain isn't available, so the key can't be stored safely.");
    await writeFileAtomic(this.file, this.cipher.encrypt(key).toString("base64"));
  }
}
