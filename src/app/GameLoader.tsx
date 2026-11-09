"use client";

import dynamic from "next/dynamic";
import { es } from "@/strings/es-CR";

// Shown from the static HTML, before any JavaScript has loaded (and while the game's own chunk downloads). It matches
// the loading screen in GameCanvas, so the hand-over is seamless; the bar pulses because there is no progress to report yet.
function Splash() {
  return (
    <div className="game-loading" role="status" aria-live="polite">
      <div>
        <p>{es.loading}</p>
        <div className="game-loading-bar" aria-hidden="true">
          <div className="game-loading-fill game-loading-wait" />
        </div>
      </div>
    </div>
  );
}

// The engine touches window / WebGL, so it never runs during the static export.
const GameCanvas = dynamic(() => import("./GameCanvas"), { ssr: false, loading: Splash });

export default function GameLoader() {
  return <GameCanvas />;
}
