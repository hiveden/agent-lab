import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Keep the PoC completely isolated from the apps/web build.
  // No transpilePackages needed — CopilotKit v2 ships ESM + CJS.
};

export default config;
