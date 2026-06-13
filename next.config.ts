import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Types are enforced via `tsc --noEmit`; don't let a stray lint rule block deploys.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
