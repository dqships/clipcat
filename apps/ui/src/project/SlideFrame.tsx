import type { Asset } from "@clipcat/core";
import { type Ref, useEffect, useRef, useState } from "react";

/** A short fingerprint of a slide's design, so a new design loads a new page. */
export function designKey(html: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) h = Math.imul(h ^ html.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Where main serves a slide's page. */
export const slideUrl = (projectId: string, asset: Pick<Asset, "id" | "slide">) => `slide://${projectId}/${asset.id}?v=${designKey(asset.slide?.html ?? "")}`;

/** Shows `t` seconds of the slide in `frame`. */
export function seekSlide(frame: HTMLIFrameElement | null, t: number): void {
  // The page has no origin of its own (it is sandboxed), so the message can't name one.
  frame?.contentWindow?.postMessage({ type: "clipcat-seek", t }, "*");
}

type Props = {
  projectId: string;
  asset: Pick<Asset, "id" | "slide" | "media">;
  /** The size the slide was designed at; it lays out on this many CSS pixels, then is scaled to cover its box. */
  frame: { width: number; height: number };
  onLoad: (frame: HTMLIFrameElement) => void;
  ref?: Ref<HTMLIFrameElement>;
};

/**
 * A motion slide, running live in a sandboxed frame that can run its own
 * script and nothing else, scaled to cover its b-roll box. The preview moves
 * it to the playhead by message.
 */
export function SlideFrame({ projectId, asset, frame, onLoad, ref }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0, x: 0, y: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const scale = Math.max(width / frame.width, height / frame.height);
      setFit({ scale, x: (width - frame.width * scale) / 2, y: (height - frame.height * scale) / 2 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame.width, frame.height]);

  return (
    <div ref={box} className="broll__media broll__slide">
      <iframe
        ref={ref}
        className="broll__frame"
        title="Slide"
        src={slideUrl(projectId, asset)}
        sandbox="allow-scripts"
        tabIndex={-1}
        style={{
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
          visibility: fit.scale > 0 ? "visible" : "hidden",
        }}
        onLoad={(e) => onLoad(e.currentTarget)}
      />
    </div>
  );
}
