// The home page's picture of a first edit: the tracks ClipCat fills for an
// example project. Drawn in HTML so it stays sharp and themed; it's an
// illustration, so the whole figure has one text alternative.

type Piece =
  | { clip: string; grow: number; tape?: boolean; wide?: boolean }
  | { space: number }
  | { wave: number; seed: number }
  | { cut: true; wide?: boolean };

const CUT: Piece = { cut: true };

// V1 and A1 share their lengths, so the cuts line up down the tracks.
const TAKES = [1.6, 2.2, 1.2, 2, 1.4];

const TRACKS: { id: string; name: string; pieces: Piece[] }[] = [
  {
    id: "V3",
    name: "Slides",
    pieces: [{ space: 1.4 }, { clip: "Title: Why launch twice", grow: 1.5, tape: true }, { space: 2.6 }, { clip: "List: three steps", grow: 1.3, tape: true, wide: true }, { space: 1.6 }],
  },
  {
    id: "V2",
    name: "B-roll",
    pieces: [{ space: 2.6 }, { clip: "screen-02.mov", grow: 1.3 }, { space: 1.6 }, { clip: "demo.png, picture in picture", grow: 1.5, wide: true }, { space: 1.4 }],
  },
  {
    id: "V1",
    name: "Camera",
    pieces: [
      { clip: "C0475 · push in", grow: TAKES[0] },
      CUT,
      { clip: "C0476", grow: TAKES[1] },
      CUT,
      { clip: "C0478 · snap", grow: TAKES[2] },
      CUT,
      { clip: "C0479", grow: TAKES[3] },
      { cut: true, wide: true },
      { clip: "C0481 · slow creep", grow: TAKES[4], wide: true },
    ],
  },
  {
    id: "T1",
    name: "Captions",
    pieces: [
      { clip: "So the first thing", grow: 1.6 },
      { clip: "you want", grow: 1.1 },
      { clip: "is a clear hook.", grow: 1.4 },
      { clip: "Say what it is", grow: 1.4 },
      { clip: "in one sentence.", grow: 1.6, wide: true },
      { space: 1.3 },
    ],
  },
  {
    id: "A1",
    name: "Voice",
    pieces: [
      { wave: TAKES[0], seed: 3 },
      CUT,
      { wave: TAKES[1], seed: 11 },
      CUT,
      { wave: TAKES[2], seed: 23 },
      CUT,
      { wave: TAKES[3], seed: 41 },
      { cut: true, wide: true },
      { wave: TAKES[4], seed: 59 },
    ],
  },
  {
    id: "A2",
    name: "Sound",
    pieces: [{ space: 0.5 }, { clip: "whoosh", grow: 0.6 }, { space: 2.4 }, { clip: "pop", grow: 0.5 }, { space: 1.4 }, { clip: "click", grow: 0.6, wide: true }, { space: 2.6 }],
  },
  { id: "A3", name: "Music", pieces: [{ clip: "music-bed.mp3, ducks under your voice", grow: 1 }] },
];

/** Bar heights for a voice clip, the same on every build. */
function bars(count: number, seed: number) {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < count; i++) {
    s = (s * 9301 + 49297) % 233280;
    const envelope = 0.35 + 0.65 * Math.abs(Math.sin(i / 4));
    out.push(4 + 24 * (s / 233280) * envelope);
  }
  return out;
}

function Wave({ grow, seed }: { grow: number; seed: number }) {
  const heights = bars(Math.round(grow * 24), seed);
  return (
    <svg className="tl__wave" style={{ flexGrow: grow }} viewBox={`0 0 ${heights.length * 4} 32`} preserveAspectRatio="none" aria-hidden="true">
      {heights.map((h, i) => (
        <rect key={i} x={i * 4} y={(32 - h) / 2} width="2" height={h} rx="1" />
      ))}
    </svg>
  );
}

export function Timeline({ caption }: { caption: string }) {
  return (
    <figure className="tl">
      <div className="tl__top" aria-hidden="true">
        <span className="tl__project">launch-video</span>
        <span className="tl__meta">Example · 7 takes · 21:31 raw, 8:52 edited</span>
      </div>
      <div className="tl__tracks" aria-hidden="true">
        <div className="tl__playhead" />
        {TRACKS.map((t) => (
          <div className="tl__track" key={t.id}>
            <div className="tl__head">
              <span className="tl__id">{t.id}</span>
              <span className="tl__name">{t.name}</span>
            </div>
            <div className="tl__lane">
              {t.pieces.map((p, i) => {
                if ("space" in p) return <span key={i} className="tl__space" style={{ flexGrow: p.space }} />;
                if ("wave" in p) return <Wave key={i} grow={p.wave} seed={p.seed} />;
                if ("cut" in p) return <span key={i} className={p.wide ? "tl__cut tl--wide" : "tl__cut"} />;
                const cls = ["tl__clip", p.tape ? "tl__clip--tape" : "", p.wide ? "tl--wide" : ""].filter(Boolean).join(" ");
                return (
                  <span key={i} className={cls} style={{ flexGrow: p.grow }}>
                    {p.clip}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="tl__caption">{caption}</figcaption>
    </figure>
  );
}
