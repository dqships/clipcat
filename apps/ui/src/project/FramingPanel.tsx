import { type EditOp, type Project, framingAt } from "@clipcat/core";
import type { Playhead } from "./Preview";

type Props = { project: Project; playhead: Playhead | null; onEdit: (op: EditOp) => void };

/**
 * The project's shape, and for the vertical one where the crop sits: it
 * follows the speaker's face by itself, or stays where it's put for the
 * recording at the playhead.
 */
export function FramingPanel({ project, playhead, onEdit }: Props) {
  const tall = project.aspectRatio === "9:16";
  const sources = [...project.sources].sort((a, b) => a.order - b.order);
  const source = sources.find((s) => s.id === playhead?.sourceId) ?? sources[0];
  const auto = source?.framing !== "manual";
  // Following faces, the crop moves at cuts; the slider shows where it sits on average.
  const x = source ? framingAt(source, 0, source.media.duration) : 0.5;
  const found = source?.faces?.length ?? 0;
  const name = source?.path.split(/[\\/]/).at(-1) ?? "";

  return (
    <section className="panel" aria-labelledby="framing-title">
      <h2 id="framing-title" className="section-title">
        Video shape
      </h2>
      <label className="field">
        <span className="field__label">Shape</span>
        <select
          className="field__control"
          value={tall ? "9:16" : "16:9"}
          onChange={(e) => onEdit({ type: "aspect", aspectRatio: e.target.value as "16:9" | "9:16" })}
        >
          <option value="16:9">Landscape 16:9 (YouTube)</option>
          <option value="9:16">Vertical 9:16 (Shorts, TikTok, Reels)</option>
        </select>
      </label>
      {tall && source && (
        <>
          <label className="field field--inline">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => onEdit({ type: "frame", sourceId: source.id, x: e.target.checked ? null : x })}
            />
            Follow the speaker
          </label>
          <p className="project__summary">
            {auto
              ? found > 0
                ? "The crop finds the face in each kept stretch and moves only at cuts."
                : source.faces === null
                  ? "Looking for faces once the recording is prepared."
                  : "No face found, so the crop stays where it's set."
              : `The crop stays where it's set for ${name}.`}
          </p>
          <label className="field">
            <span className="field__label">{sources.length > 1 ? `Position in ${name}` : "Position"}</span>
            <input
              className="field__range"
              type="range"
              aria-label="Crop position"
              min={0}
              max={1}
              step={0.01}
              value={x}
              onChange={(e) => onEdit({ type: "frame", sourceId: source.id, x: Number(e.target.value) })}
            />
          </label>
        </>
      )}
    </section>
  );
}
