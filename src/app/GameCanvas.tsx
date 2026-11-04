"use client";

import { useEffect, useRef, useState } from "react";
import { createRuntime, type PlayerStatus, type Runtime } from "@/engine/runtime";
import { QUALITY_LEVELS, type QualityLevel } from "@/engine/quality";
import { es } from "@/strings/es-CR";

export default function GameCanvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [locked, setLocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [quality, setQuality] = useState<QualityLevel>("high");
  const [status, setStatus] = useState<PlayerStatus | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const runtime = createRuntime(root, {
      onLockChange: (isLocked) => {
        setLocked(isLocked);
        if (isLocked) setStarted(true);
      },
      onStatus: setStatus,
    });
    runtimeRef.current = runtime;
    setQuality(runtime.getQuality());
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
      {status && (
        <div className="game-flashlight" aria-label={es.flashlight}>
          <div
            className={status.flashlightOn ? "game-flashlight-fill on" : "game-flashlight-fill"}
            style={{ width: `${Math.round(status.charge * 100)}%` }}
          />
        </div>
      )}
      {!locked && (
        <div className="game-hint" onClick={() => runtimeRef.current?.requestLock()}>
          <div>
            <h1>{started ? es.paused : es.clickToPlay}</h1>
            <p>{started ? es.resume : es.controls}</p>
            {!started && <p>{es.debugFloors}</p>}
            <div className="game-quality" onClick={(e) => e.stopPropagation()}>
              <span>{es.quality}</span>
              {QUALITY_LEVELS.map((level) => (
                <button
                  key={level}
                  className={level === quality ? "on" : undefined}
                  onClick={() => {
                    runtimeRef.current?.setQuality(level);
                    setQuality(level);
                  }}
                >
                  {es.qualityLevels[level]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
