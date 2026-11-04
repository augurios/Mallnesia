"use client";

import { useEffect, useRef, useState } from "react";
import { createRuntime, type PlayerStatus, type Runtime } from "@/engine/runtime";
import { es } from "@/strings/es-CR";

export default function GameCanvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState<PlayerStatus | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const runtime = createRuntime(root, { onLockChange: setLocked, onStatus: setStatus });
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  return (
    <div className="game-root" ref={rootRef}>
      {status && (
        <div className="game-status">
          {es.floor} {status.floor} · {status.x.toFixed(1)}, {status.y.toFixed(1)}
        </div>
      )}
      {!locked && (
        <div className="game-hint" onClick={() => runtimeRef.current?.requestLock()}>
          <div>
            <h1>{es.clickToPlay}</h1>
            <p>{es.controls}</p>
            <p>{es.debugFloors}</p>
          </div>
        </div>
      )}
    </div>
  );
}
