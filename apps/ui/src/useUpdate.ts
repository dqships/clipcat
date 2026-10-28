import type { UpdateStatusValue } from "@clipcat/ipc";
import { useEffect, useState } from "react";
import { bridge } from "./bridge";

/** Where updating stands, kept current from the main process. */
export function useUpdate(): UpdateStatusValue | null {
  const [status, setStatus] = useState<UpdateStatusValue | null>(null);
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    void api.invoke("update:status").then(setStatus, () => {});
    return api.on("update", setStatus);
  }, []);
  return status;
}
