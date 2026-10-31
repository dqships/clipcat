import { type EditOp, type Project, SOUND_EFFECTS, buildTimeline, timedMusic, timedSounds } from "@clipcat/core";
import { Music, Play, X } from "lucide-react";
import { useMemo, useState } from "react";
import { bridge } from "../bridge";
import { formatDuration } from "../format";
import { ICON_STROKE } from "../icons";

type Props = { project: Project; onSeek: (sourceId: string, time: number) => void; onEdit: (op: EditOp) => void };

/** Where main serves a sound effect's file. */
export const effectUrl = (id: string) => `sound://sfx/${id}.wav`;

export const EFFECTS = new Map(SOUND_EFFECTS.map((e) => [e.id, e]));

const EFFECT_LEVELS = [
  { value: 0.35, label: "Soft" },
  { value: 0.7, label: "Normal" },
  { value: 1, label: "Loud" },
];
const MUSIC_LEVELS = [
  { value: 0.08, label: "Quiet" },
  { value: 0.15, label: "Low" },
  { value: 0.3, label: "Medium" },
  { value: 0.5, label: "Loud" },
];

/** The level in `levels` closest to `volume`, so a volume set elsewhere still shows as one. */
export const nearestLevel = (levels: { value: number }[], volume: number) =>
  levels.reduce((best, l) => (Math.abs(l.value - volume) < Math.abs(best - volume) ? l.value : best), levels[0]!.value);

/** Plays a media element, ignoring a refused or unsupported play. */
export function playQuietly(el: HTMLMediaElement): void {
  try {
    void el.play()?.catch(() => {});
  } catch {
    // jsdom and a few refused autoplays throw instead of rejecting.
  }
}

let audition: HTMLAudioElement | null = null;
function hear(id: string): void {
  audition?.pause();
  audition = new Audio(effectUrl(id));
  playQuietly(audition);
}

/**
 * Sound: the effects in the edit, in play order, with how loud each is and a
 * way to take it out; the music tracks and where they're placed; and the
 * library, to listen through. New effects and placements come from the
 * transcript (select words, then Sound… or Music…) or from the AI editor.
 */
export function SoundPanel({ project, onSeek, onEdit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const timeline = useMemo(() => buildTimeline(project), [project]);
  const placed = useMemo(() => timedSounds(project, timeline), [project, timeline]);
  const text = useMemo(() => new Map(project.transcript.map((w) => [w.id, w.text])), [project.transcript]);
  const byId = new Map(project.proposals.map((p) => [p.id, p]));
  const tracks = project.music;
  const placements = useMemo(() => timedMusic(project, timeline).filter((m) => byId.get(m.id)?.music), [project, timeline]);

  const pickMusic = async () => {
    setError(null);
    const b = bridge();
    if (!b) return;
    try {
      for (const file of await b.invoke("music:pick")) await b.invoke("project:add-music", { id: project.id, file });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel" aria-labelledby="sound-title">
      <h2 id="sound-title" className="section-title">
        Sound
      </h2>
      <p className="project__summary">
        {placed.length === 0
          ? "Select words in the transcript to land a sound effect on them, or run the AI editor for suggestions."
          : `${placed.length} ${placed.length === 1 ? "effect" : "effects"} in the edit.`}
      </p>
      {placed.length > 0 && (
        <ol className="punches">
          {placed.map((s) => {
            const at = formatDuration(s.time);
            const word = text.get(byId.get(s.id)?.wordIds[0] ?? "");
            const name = EFFECTS.get(s.effect)?.name ?? s.effect;
            return (
              <li key={s.id} className="punches__item">
                <button type="button" className="punches__where" onClick={() => onSeek(s.sourceId, s.at)}>
                  <span className="punches__time">{at}</span>
                  <span className="punches__words">
                    {name}
                    {word ? ` on “${word}”` : ""}
                  </span>
                </button>
                <select
                  className="field__control"
                  aria-label={`Volume of the ${name} at ${at}`}
                  value={nearestLevel(EFFECT_LEVELS, s.volume)}
                  onChange={(e) => onEdit({ type: "sound-volume", id: s.id, volume: Number(e.target.value) })}
                >
                  {EFFECT_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button--icon"
                  aria-label={`Remove the ${name} at ${at}`}
                  onClick={() => onEdit({ type: "decide", ids: [s.id], status: "rejected" })}
                >
                  <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <h3 className="sound__heading">Music</h3>
      <p className="project__summary">
        {tracks.length < 2
          ? "Add a track to play under the whole video. Add more to give parts of the video their own music."
          : "Select words in the transcript to play a track over them, or say how each one sounds and run the AI editor for suggestions."}
      </p>
      {tracks.length > 0 && (
        <ul className="punches" aria-label="Music tracks">
          {tracks.map((t) => (
            <li key={t.id} className="punches__item punches__item--wrap">
              <span className="sound__music">
                {t.name}
                <span className="media__kind">{t.prep ? formatDuration(t.duration) : "Preparing…"}</span>
              </span>
              <select
                className="field__control"
                aria-label={`Volume of ${t.name}`}
                value={nearestLevel(MUSIC_LEVELS, t.volume)}
                onChange={(e) => onEdit({ type: "music", id: t.id, volume: Number(e.target.value) })}
              >
                {MUSIC_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <select
                className="field__control"
                aria-label={`Where ${t.name} plays`}
                value={t.whole ? "whole" : "placed"}
                onChange={(e) => onEdit({ type: "music", id: t.id, whole: e.target.value === "whole" })}
              >
                <option value="whole">Whole video</option>
                <option value="placed">Where placed</option>
              </select>
              <button type="button" className="button button--icon" aria-label={`Remove ${t.name}`} onClick={() => onEdit({ type: "remove-music", id: t.id })}>
                <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              </button>
              <label className="field field--inline sound__row">
                <input type="checkbox" checked={t.duck} onChange={(e) => onEdit({ type: "music", id: t.id, duck: e.target.checked })} />
                Lower {t.name} while you talk
              </label>
              <input
                key={t.description}
                className="field__control sound__row"
                aria-label={`How ${t.name} sounds`}
                placeholder="How it sounds, for the AI editor"
                maxLength={1000}
                defaultValue={t.description}
                onBlur={(e) => {
                  if (e.target.value !== t.description) onEdit({ type: "music", id: t.id, description: e.target.value });
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {placements.length > 0 && (
        <ol className="punches" aria-label="Music placed in the edit">
          {placements.map((m) => {
            const p = byId.get(m.id)!;
            const at = `${formatDuration(m.start)} to ${formatDuration(m.end)}`;
            return (
              <li key={m.id} className="punches__item">
                <button type="button" className="punches__where" onClick={() => onSeek(p.sourceId, p.music!.range[0])}>
                  <span className="punches__time">{at}</span>
                  <span className="punches__words">{m.track.name}</span>
                </button>
                <button
                  type="button"
                  className="button button--icon"
                  aria-label={`Remove ${m.track.name} at ${at}`}
                  onClick={() => onEdit({ type: "decide", ids: [m.id], status: "rejected" })}
                >
                  <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <button type="button" className="button" onClick={() => void pickMusic()}>
          <Music className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          Add music
        </button>
      </div>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
      <details className="sound__library">
        <summary>Sound library</summary>
        <ul className="sound__effects">
          {SOUND_EFFECTS.map((e) => (
            <li key={e.id} className="sound__effect">
              <button type="button" className="button button--icon" aria-label={`Play ${e.name}`} onClick={() => hear(e.id)}>
                <Play className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              </button>
              <span>
                <span className="sound__name">{e.name}</span> <span className="sound__meaning">{e.meaning}</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
