import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ssh2", "prisma"],
  // @ts-ignore
  allowedDevOrigins: ["100.101.46.57"],
  devIndicators: false,
};

export default nextConfig;
