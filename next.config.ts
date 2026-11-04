import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  // Relative URLs so the exported folder works from any subpath (itch.io). Dev serves from "/".
  assetPrefix: process.env.NODE_ENV === "production" ? "./" : undefined,
};

export default nextConfig;
