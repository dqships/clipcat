import type { AppInfoValue } from "@clipcat/ipc";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { ICON_STROKE } from "./icons";

type Props = { info: AppInfoValue | null; error: string | null };

/** One quiet line at the foot of the window: app version and whether the bundled tools run. */
export function StatusBar({ info, error }: Props) {
  if (error) {
    return (
      <footer className="status status--danger" role="status">
        <TriangleAlert className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        <span>Couldn't reach the app: {error}</span>
      </footer>
    );
  }
  if (!info) return <footer className="status" role="status" />;

  const missing = (
    [
      ["ffmpeg", info.ffmpeg],
      ["whisper-cli", info.whisper],
    ] as const
  ).find(([, t]) => !t.available);
  const ok = !missing;
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <footer className={ok ? "status" : "status status--danger"} role="status">
      <span>
        {info.name} {info.version}
      </span>
      <span className="status__sep" aria-hidden>
        ·
      </span>
      <Icon className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
      <span>{missing ? `${missing[0]} not found at ${missing[1].path}` : info.ffmpeg.version}</span>
    </footer>
  );
}
