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
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [savedTimes, setSavedTimes] = useState<{ manual: number | null; checkpoint: number | null }>({ manual: null, checkpoint: null });
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
      onSubtitle: setSubtitle,
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

  // The pause menu reads the saved times each time it opens (a checkpoint may have been written while playing).
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!locked && runtime) setSavedTimes({ manual: runtime.savedAt("manual"), checkpoint: runtime.savedAt("checkpoint") });
  }, [locked]);

  const refreshTimes = (runtime: Runtime) => setSavedTimes({ manual: runtime.savedAt("manual"), checkpoint: runtime.savedAt("checkpoint") });
  const saveGame = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const result = runtime.save();
    setSaveMsg(result === "saved" ? es.saved : result === "unsaved" ? es.savedSession : es.saveBlocked);
    refreshTimes(runtime);
  };
  const loadGame = (slot: "manual" | "checkpoint") => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setSaveMsg(runtime.load(slot) ? es.loaded : es.noSave);
  };
  const when = (t: number | null) => (t ? new Date(t).toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" }) : null);

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
        <div className="game-vitals">
          <label className={status.sanity < 0.3 ? "critical" : undefined}>
            {es.sanity}
            <meter min={0} max={100} low={30} optimum={100} value={Math.round(status.sanity * 100)} />
            <span>{Math.ceil(status.sanity * 100)}%</span>
          </label>
          <label className={status.exhausted ? "critical" : undefined}>
            {es.stamina}
            <meter min={0} max={100} low={30} optimum={100} value={Math.round(status.stamina * 100)} />
          </label>
          <label className={status.flashlightOn ? "lit" : undefined}>
            {es.flashlight}
            <meter min={0} max={100} low={15} optimum={100} value={Math.round(status.charge * 100)} />
          </label>
        </div>
      )}
      {locked && subtitle && <div className="game-subtitle">{subtitle}</div>}
      {locked && status?.prompt && <div className="game-prompt">{notice ?? es.prompts[status.prompt]}</div>}
      {locked && !status?.prompt && notice && <div className="game-prompt">{notice}</div>}
      {!locked && (
        <div className="game-hint" onClick={() => runtimeRef.current?.requestLock()}>
          <div>
            <h1>{started ? es.paused : es.clickToPlay}</h1>
            <p>{started ? es.resume : es.controls}</p>
            {!started && <p>{es.debugFloors}</p>}
            {!started && <p>{es.debugDoors}</p>}
            {!started && <p>{es.debugSanity}</p>}
            {!started && <p>{es.debugShadow}</p>}
            {!started && <p>{es.debugFaint}</p>}
            <div className="game-quality" onClick={(e) => e.stopPropagation()}>
              {started && <button onClick={saveGame}>{es.saveGame}</button>}
              <button disabled={savedTimes.manual === null} onClick={() => loadGame("manual")}>
                {es.loadGame}
              </button>
              {savedTimes.manual !== null && (
                <span>
                  {es.savedAt} {when(savedTimes.manual)}
                </span>
              )}
            </div>
            {savedTimes.checkpoint !== null && (
              <div className="game-quality" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => loadGame("checkpoint")}>{es.loadCheckpoint}</button>
                <span>{when(savedTimes.checkpoint)}</span>
              </div>
            )}
            {saveMsg && (
              <p role="status" onClick={(e) => e.stopPropagation()}>
                {saveMsg}
              </p>
            )}
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
