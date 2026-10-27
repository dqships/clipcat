import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Cipher, KeyStore } from "./keys";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clipcat-keys-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Stands in for the keychain: reverses the bytes. */
const cipher = (available = true): Cipher => ({
  available: () => available,
  encrypt: (plain) => Buffer.from(plain, "utf8").reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString("utf8"),
});

describe("KeyStore", () => {
  it("keeps the key encrypted on disk and removes it", async () => {
    const keys = new KeyStore(join(dir, "key"), cipher());
    expect(await keys.get()).toBeNull();
    await keys.set("sk-ant-secret");
    expect(await readFile(join(dir, "key"), "utf8")).not.toContain("sk-ant-secret");
    expect(await keys.get()).toBe("sk-ant-secret");
    await keys.set(null);
    expect(await keys.get()).toBeNull();
  });

  it("refuses to store a key without a keychain", async () => {
    await expect(new KeyStore(join(dir, "key"), cipher(false)).set("sk-ant-secret")).rejects.toThrow(/keychain/);
  });
});
