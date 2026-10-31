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
  it("adds a track at once, under the whole video, and prepares a copy for the preview", async () => {
    const { store, queue, music, prepared, id } = await setup();
    const added = await music.add(id, "/m/song.mp3");
    expect(added.music).toEqual([{ id: expect.stringMatching(/^t/), path: "/m/song.mp3", name: "song.mp3", duration: 95, volume: 0.15, duck: true, prep: null, description: "", whole: true }]);
    await queue.idle(id);
    const prep = (await store.get(id)).music[0]!.prep!;
    expect(prep).toMatch(new RegExp(`^${MUSIC_DIR}/[a-f0-9-]{8}\\.m4a$`));
    expect(prepared).toEqual([join(store.dir(id), prep)]);
  });

  it("keeps every track it's given, each with the level and ducking of the last, and only the first plays throughout", async () => {
    const { store, queue, music, id } = await setup();
    await music.add(id, "/m/one.mp3");
    await queue.idle(id);
    await store.update(id, null, (p) => {
      p.music[0]!.volume = 0.3;
      p.music[0]!.duck = false;
    });
    const next = await music.add(id, "/m/two.wav");
    expect(next.music.map((t) => t.name)).toEqual(["one.mp3", "two.wav"]);
    expect(next.music[1]).toMatchObject({ volume: 0.3, duck: false, prep: null, whole: false });
    await queue.idle(id);
    expect(await readdir(join(store.dir(id), MUSIC_DIR))).toHaveLength(2);
  });

  it("doesn't add the same file twice", async () => {
    const { queue, music, id } = await setup();
    await music.add(id, "/m/one.mp3");
    expect((await music.add(id, "/m/one.mp3")).music).toHaveLength(1);
    await queue.idle(id);
  });

  it("refuses a file without sound, and forgets only the copies no track uses", async () => {
    const { store, queue, music, id } = await setup();
    await expect(music.add(id, "/m/notes.txt")).rejects.toThrow("notes.txt: This file has no sound in it.");
    expect((await store.get(id)).music).toEqual([]);
    await music.add(id, "/m/one.mp3");
    await music.add(id, "/m/two.mp3");
    await queue.idle(id);
    await store.update(id, null, (p) => {
      p.music = p.music.filter((t) => t.name === "two.mp3");
    });
    await music.forget(id);
    const kept = (await store.get(id)).music[0]!;
    expect(await readdir(join(store.dir(id), MUSIC_DIR))).toEqual([kept.prep!.slice(MUSIC_DIR.length + 1)]);
  });
});
