import { CAPTION_SWATCHES } from "@clipcat/core";
import { Pipette } from "lucide-react";
import { ICON_STROKE } from "../icons";

type Props = {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (color: string) => void;
};

/** A row of ready-made colours, then the system colour picker for anything else. */
export function ColorField({ label, value, disabled, onChange }: Props) {
  const current = value.toUpperCase();
  const custom = !CAPTION_SWATCHES.some((s) => s.color === current);
  return (
    <fieldset className="field color-field" disabled={disabled}>
      <legend className="field__label">{label}</legend>
      <div className="color-field__swatches">
        {CAPTION_SWATCHES.map((s) => (
          <button
            key={s.color}
            type="button"
            className="color-field__swatch"
            style={{ background: s.color }}
            aria-label={s.name}
            aria-pressed={current === s.color}
            title={s.name}
            onClick={() => onChange(s.color)}
          />
        ))}
        <label
          className={custom ? "color-field__other color-field__other--on" : "color-field__other"}
          style={custom ? { background: value } : undefined}
          title="Another colour"
        >
          {!custom && <Pipette className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />}
          <input type="color" value={value} aria-label={`Another ${label.toLowerCase()}`} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </label>
      </div>
    </fieldset>
  );
}
