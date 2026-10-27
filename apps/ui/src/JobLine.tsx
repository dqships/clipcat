import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { ICON_STROKE } from "./icons";
import type { ProjectJobs } from "./useJobs";

/**
 * One line of a project's background work: what is running and how far along,
 * or what failed. With `onCancel`, a button stops the running job and the ones
 * waiting behind it.
 */
export function JobLine({ jobs, onCancel }: { jobs: ProjectJobs; onCancel?: () => void }) {
  const { active, waiting, failed } = jobs;
  if (active) {
    const pct = active.fraction === null ? null : Math.round(active.fraction * 100);
    return (
      <div className="job" role="status">
        <span className="job__label">
          <LoaderCircle className="icon-sm job__spin" strokeWidth={ICON_STROKE} aria-hidden />
          {active.label}
          {waiting > 0 && <span className="job__more"> · {waiting} more</span>}
          {onCancel && (
            <button type="button" className="button button--icon job__cancel" aria-label={`Cancel ${active.label}`} title="Cancel" onClick={onCancel}>
              <X className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          )}
        </span>
        <progress className="job__bar" max={100} value={pct ?? undefined} aria-label={active.label} />
      </div>
    );
  }
  if (failed) {
    return (
      <p className="job job--danger" role="status">
        <TriangleAlert className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        {failed.label} failed: {failed.error}
      </p>
    );
  }
  return null;
}
