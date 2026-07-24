// prisma.config.ts
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

config({ override: true });

export default defineConfig({
  schema: "server/prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
