import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["ssh2", "prisma"],
  allowedDevOrigins: ["100.101.46.57"],
  devIndicators: false,
};

export default nextConfig;
