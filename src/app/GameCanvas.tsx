"use client";

import { useEffect, useRef, useState } from "react";
import { createRuntime, type Runtime } from "@/engine/runtime";
import { es } from "@/strings/es-CR";

export default function GameCanvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const runtime = createRuntime(root, { onLockChange: setLocked });
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  return (
    <div className="game-root" ref={rootRef}>
      {!locked && (
        <div className="game-hint" onClick={() => runtimeRef.current?.requestLock()}>
          <div>
            <h1>{es.clickToPlay}</h1>
            <p>{es.controls}</p>
          </div>
        </div>
      )}
    </div>
  );
}
