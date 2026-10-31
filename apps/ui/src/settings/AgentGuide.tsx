import { BookOpen, Check, Copy } from "lucide-react";
import { useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";

/** The full guide, on the site; in the app, the link opens the same page in the Help window. */
export const GUIDE_URL = "https://clipcat.followusai.com/docs/agents";

/** Things to ask, each one doable with ClipCat's tools as they are. */
export const PROMPTS = [
  "List my ClipCat projects and tell me which ones haven't been exported yet.",
  "In ClipCat, cut the filler words and long pauses from my newest project. Show me what you'll cut before you do it.",
  "Ask ClipCat's AI editor for cuts on my newest project, then accept the retakes and leave the rest for me.",
  "In my newest ClipCat project, cut the part where I talk about pricing.",
  "Add a zoom on each line where I give a number, and a whoosh where each new topic starts.",
  "Make three ClipCat shorts of up to 60 seconds from my newest project.",
  "Write the chapters and a YouTube description for my newest ClipCat project.",
  "Import ~/Movies/take-1.mov and ~/Movies/take-2.mov into a new ClipCat project, and cut the retakes once it's transcribed.",
  "Export my newest ClipCat project as a 9:16 video to my Desktop, and save a Final Cut Pro timeline beside it.",
];

/** Prompts to copy into a connected agent, and the way to the full guide. */
export function AgentGuide() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (prompt: string) => {
    void navigator.clipboard.writeText(prompt).then(() => setCopied(prompt));
  };

  return (
    <section className="settings__group guide" aria-labelledby="guide-title">
      <h3 id="guide-title" className="settings__label">
        Things to ask
      </h3>
      <p className="settings__hint">Say "ClipCat" or "my ClipCat project" so the agent knows to use it. It reads the transcript before it changes anything.</p>
      <ul className="guide__prompts" aria-label="Example prompts">
        {PROMPTS.map((prompt) => (
          <li key={prompt} className="guide__prompt">
            <span className="guide__prompt-text">{prompt}</span>
            <button type="button" className="button button--icon" aria-label={copied === prompt ? "Copied" : "Copy prompt"} title="Copy" onClick={() => copy(prompt)}>
              {copied === prompt ? (
                <Check className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              ) : (
                <Copy className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
      <a
        className="guide__link"
        href={GUIDE_URL}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          const api = bridge();
          if (!api) return;
          e.preventDefault();
          void api.invoke("help:open", { page: "agents" });
        }}
      >
        Read the full guide
        <BookOpen className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
      </a>
    </section>
  );
}
