import type { AppInfoValue, UpdateStatusValue } from "@clipcat/ipc";
import { CircleCheck, Download, RotateCw, TriangleAlert } from "lucide-react";
import { bridge } from "./bridge";
import { ICON_STROKE } from "./icons";

type Props = { info: AppInfoValue | null; error: string | null; update?: UpdateStatusValue | null };

/** A newer version, when there is one: restart into it, or go and get it. */
function UpdateAction({ update }: { update: UpdateStatusValue | null | undefined }) {
  if (update?.state === "ready") {
    return (
      <button type="button" className="status__action" onClick={() => void bridge()?.invoke("update:install")}>
        <RotateCw className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        Restart to update{update.version ? ` to ${update.version}` : ""}
      </button>
    );
  }
  if (update?.state === "available") {
    return (
      <button type="button" className="status__action" onClick={() => void bridge()?.invoke("update:open")}>
        <Download className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        ClipCat {update.version} is out: download it
      </button>
    );
  }
  return null;
}

/** One quiet line at the foot of the window: app version, whether the bundled tools run, and a waiting update. */
export function StatusBar({ info, error, update }: Props) {
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
      <UpdateAction update={update} />
    </footer>
  );
}
