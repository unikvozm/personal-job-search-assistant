import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["playwright"],
  // A second dev server (e.g. on a test database) needs its own build folder.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default config;
