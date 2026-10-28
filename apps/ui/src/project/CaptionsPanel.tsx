import type { Captions, EditOp, Project } from "@clipcat/core";

type Props = { project: Project; onEdit: (op: EditOp) => void };

/** Caption style for the preview and the export. */
export function CaptionsPanel({ project, onEdit }: Props) {
  const c = project.captions;
  const set = (captions: Partial<Captions>) => onEdit({ type: "captions", captions });

  return (
    <section className="panel" aria-labelledby="captions-title">
      <h2 id="captions-title" className="section-title">
        Captions
      </h2>
      <label className="field field--inline">
        <input type="checkbox" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Add captions to the video
      </label>
      <div className="fields">
        <label className="field">
          <span className="field__label">Style</span>
          <select className="field__control" value={c.mode} disabled={!c.enabled} onChange={(e) => set({ mode: e.target.value as Captions["mode"] })}>
            <option value="sentence">A phrase at a time</option>
            <option value="word">Word by word</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Capitals</span>
          <select className="field__control" value={c.case} disabled={!c.enabled} onChange={(e) => set({ case: e.target.value as Captions["case"] })}>
            <option value="regular">As spoken</option>
            <option value="upper">ALL CAPS</option>
            <option value="lower">all lowercase</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Caption background</span>
          <select
            className="field__control"
            value={c.background}
            disabled={!c.enabled}
            onChange={(e) => set({ background: e.target.value as Captions["background"] })}
          >
            <option value="none">None</option>
            <option value="rounded">A box</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Size</span>
          <input
            className="field__range"
            type="range"
            min={32}
            max={96}
            step={2}
            value={c.size}
            disabled={!c.enabled}
            onChange={(e) => set({ size: Number(e.target.value) })}
          />
        </label>
      </div>
    </section>
  );
}
