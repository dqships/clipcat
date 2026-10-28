import { type KeyboardEvent, type ReactNode, useState } from "react";

const TABS = [
  { id: "edit", label: "Edit" },
  { id: "look", label: "Look" },
  { id: "publish", label: "Publish" },
  { id: "export", label: "Export" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Props = Record<TabId, ReactNode> & {
  /** Suggested edits waiting on a decision, shown on the Edit tab so they're found from any tab. */
  pending: number;
};

/**
 * The tools in the order the work goes: the edit itself, how it looks, what
 * goes out with it, then export. Every tab stays mounted, so a half-typed
 * brief or title survives a switch.
 */
export function Tools({ pending, ...panels }: Props) {
  const [tab, setTab] = useState<TabId>("edit");

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const at = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(at + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!.id;
    setTab(next);
    document.getElementById(`tools-tab-${next}`)?.focus();
  };

  return (
    <div className="tools">
      <div className="tools__tabs" role="tablist" aria-label="Tools" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tools-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tools-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "guide__tab guide__tab--on" : "guide__tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "edit" && pending > 0 && (
              <span className="tools__count">
                {pending}
                <span className="visually-hidden"> to review</span>
              </span>
            )}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.id} id={`tools-${t.id}`} className="tools__panel" role="tabpanel" aria-labelledby={`tools-tab-${t.id}`} hidden={tab !== t.id}>
          {panels[t.id]}
        </div>
      ))}
    </div>
  );
}
