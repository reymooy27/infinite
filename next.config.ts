import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ssh2", "prisma", "puppeteer"],
};

export default nextConfig;
