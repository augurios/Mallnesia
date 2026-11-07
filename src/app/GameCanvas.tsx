"use client";

import { useEffect, useRef, useState } from "react";
import { createRuntime, type PlayerStatus, type Runtime } from "@/engine/runtime";
import { QUALITY_LEVELS, type QualityLevel } from "@/engine/quality";
import { SENSITIVITY_MAX, SENSITIVITY_MIN, SENSITIVITY_STEP, type ViewSettings } from "@/engine/view";
import { es } from "@/strings/es-CR";

export default function GameCanvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  const hudOff = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("hud") === "off"; // debug: ?hud=off hides the overlays (screenshots)
  const runtimeRef = useRef<Runtime | null>(null);
  const [locked, setLocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [quality, setQuality] = useState<QualityLevel>("high");
  const [view, setView] = useState<ViewSettings>({ sensitivity: 1, motion: true });
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const runtime = createRuntime(root, {
      onLockChange: (isLocked) => {
        setLocked(isLocked);
        if (isLocked) setStarted(true);
      },
      onStatus: setStatus,
      onNotice: (key) => {
        setNotice(es[key]);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 1800);
      },
    });
    runtimeRef.current = runtime;
    setQuality(runtime.getQuality());
    setView(runtime.getView());
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  const changeView = (next: ViewSettings) => {
    runtimeRef.current?.setView(next);
    setView(runtimeRef.current?.getView() ?? next);
  };

  return (
    <div className="game-root" ref={rootRef} data-hud={hudOff ? "off" : undefined}>
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
      {locked && status?.canInteract && <div className="game-prompt">{notice ?? es.interact}</div>}
      {locked && !status?.canInteract && notice && <div className="game-prompt">{notice}</div>}
      {!locked && (
        <div className="game-hint" onClick={() => runtimeRef.current?.requestLock()}>
          <div>
            <h1>{started ? es.paused : es.clickToPlay}</h1>
            <p>{started ? es.resume : es.controls}</p>
            {!started && <p>{es.debugFloors}</p>}
            {!started && <p>{es.debugDoors}</p>}
            {!started && <p>{es.debugSanity}</p>}
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
            <div className="game-quality" onClick={(e) => e.stopPropagation()}>
              <label htmlFor="game-sensitivity">{es.sensitivity}</label>
              <input
                id="game-sensitivity"
                type="range"
                min={SENSITIVITY_MIN}
                max={SENSITIVITY_MAX}
                step={SENSITIVITY_STEP}
                value={view.sensitivity}
                onChange={(e) => changeView({ ...view, sensitivity: parseFloat(e.target.value) })}
              />
              <span className="game-value">{view.sensitivity.toFixed(1)}</span>
            </div>
            <div className="game-quality" onClick={(e) => e.stopPropagation()}>
              <span>{es.cameraMotion}</span>
              {[true, false].map((motion) => (
                <button key={String(motion)} className={view.motion === motion ? "on" : undefined} onClick={() => changeView({ ...view, motion })}>
                  {motion ? es.on : es.off}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
