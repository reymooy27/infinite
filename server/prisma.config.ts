// prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // The CLI (migrate, introspect) will use this.
    // Point this to your DIRECT connection string.
    url: env("DIRECT_URL"),
  },
});
