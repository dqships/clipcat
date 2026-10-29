import { useEffect, useRef, useState } from "react";

type Props = {
  name: string;
  label: string;
  className?: string;
  /** Called with the new name; an empty or unchanged name just closes the field. */
  onRename: (name: string) => void;
  onDone: () => void;
};

/** A name being edited in place. Enter or leaving the field keeps it, Escape puts the old one back. */
export function NameField({ name, label, className, onRename, onDone }: Props) {
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => input.current?.select(), []);

  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    if (keep && next && next !== name) onRename(next);
    onDone();
  };

  return (
    <input
      ref={input}
      className={className ? `field__control name-field ${className}` : "field__control name-field"}
      aria-label={label}
      value={value}
      maxLength={200}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}
