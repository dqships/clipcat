import type { AppInfoValue } from "@clipcat/ipc";
import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { Library } from "./library/Library";
import { StatusBar } from "./StatusBar";

export function App() {
  const [info, setInfo] = useState<AppInfoValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = bridge();
    if (!api) return;
    api
      .invoke("app:info")
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void api.invoke("app:ready", { screen: "library" });
  }, []);

  return (
    <div className="app">
      <Library />
      <StatusBar info={info} error={error} />
    </div>
  );
}
