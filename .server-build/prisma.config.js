// prisma.config.ts
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";
config({ override: true });
export default defineConfig({
    schema: "prisma/schema.prisma",
    datasource: {
        url: env("DATABASE_URL", "file:./infinite.db"),
    },
});
