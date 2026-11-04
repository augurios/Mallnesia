"use client";

import dynamic from "next/dynamic";

// The engine touches window / WebGL, so it never runs during the static export.
const GameCanvas = dynamic(() => import("./GameCanvas"), { ssr: false });

export default function GameLoader() {
  return <GameCanvas />;
}
