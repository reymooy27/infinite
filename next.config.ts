import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ssh2", "prisma"],
  // @ts-expect-error Next exposes this before the local type definition catches up.
  allowedDevOrigins: ["100.101.46.57"],
  devIndicators: false,
};

export default nextConfig;
