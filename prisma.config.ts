import { defineConfig } from "@prisma/config";

export default defineConfig({
  datasource: {
    // This is for Vercel (Production/Preview)
    // Uses the Pooler (Port 6543) + IPv4 support
    url: process.env.DATABASE_URL,

    // This is for Migrations (Local/Build time)
    // Uses the Direct Connection (Port 5432)
    directUrl: process.env.DIRECT_URL,
  },
});
