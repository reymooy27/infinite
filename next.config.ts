import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ssh2", "prisma", "puppeteer"],
  devIndicators: {
    appIsrStatus: false,
  },
  // @ts-ignore
  allowedDevOrigins: ["100.101.46.57"],
};

export default nextConfig;
