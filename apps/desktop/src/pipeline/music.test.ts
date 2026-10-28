import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobQueue } from "../jobs/queue";
import { ProjectStore } from "../store/projects";
import { MUSIC_DIR, MusicPipeline } from "./music";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clipcat-music-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function setup() {
  const store = new ProjectStore(root);
  const queue = new JobQueue(() => {});
  const prepared: string[] = [];
  const music = new MusicPipeline({
    store,
    queue,
    probe: async (file) => {
      if (file.endsWith(".txt")) throw new Error("This file has no sound in it.");
      return 95;
    },
    prep: async (_file, _duration, out) => {
      prepared.push(out);
      await writeFile(out, "aac");
    },
    changed: () => {},
  });
  const project = await store.create("talk");
  return { store, queue, music, prepared, id: project.id };
}

describe("MusicPipeline", () => {
  it("puts the music on at once and prepares a copy for the preview", async () => {
    const { store, queue, music, prepared, id } = await setup();
    const set = await music.set(id, "/m/song.mp3");
    expect(set.music).toEqual({ path: "/m/song.mp3", name: "song.mp3", duration: 95, volume: 0.15, duck: true, prep: null });
    await queue.idle(id);
    const prep = (await store.get(id)).music!.prep!;
    expect(prep).toMatch(new RegExp(`^${MUSIC_DIR}/[a-f0-9-]{8}\\.m4a$`));
    expect(prepared).toEqual([join(store.dir(id), prep)]);
  });

  it("keeps the level and ducking of the music it replaces, and only the new copy", async () => {
    const { store, queue, music, id } = await setup();
    await music.set(id, "/m/one.mp3");
    await queue.idle(id);
    await store.update(id, null, (p) => {
      p.music!.volume = 0.3;
      p.music!.duck = false;
    });
    const next = await music.set(id, "/m/two.wav");
    expect(next.music).toMatchObject({ name: "two.wav", volume: 0.3, duck: false, prep: null });
    await queue.idle(id);
    expect(await readdir(join(store.dir(id), MUSIC_DIR))).toHaveLength(1);
  });

  it("refuses a file without sound, and keeps only the copy of the music that stayed", async () => {
    const { store, queue, music, id } = await setup();
    await expect(music.set(id, "/m/notes.txt")).rejects.toThrow("notes.txt: This file has no sound in it.");
    expect((await store.get(id)).music).toBeNull();
    await music.set(id, "/m/one.mp3");
    await music.set(id, "/m/two.mp3");
    await queue.idle(id);
    const kept = (await store.get(id)).music!;
    expect(kept.name).toBe("two.mp3");
    expect(await readdir(join(store.dir(id), MUSIC_DIR))).toEqual([kept.prep!.slice(MUSIC_DIR.length + 1)]);
    await music.forget(id);
    await expect(readdir(join(store.dir(id), MUSIC_DIR))).rejects.toThrow();
  });
});
