import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  
  // Force IPv4 for Supabase connections (fixes Vercel/Fly IPv6 issues)
  if (url.includes("supabase.co") && !url.includes("family=IPv4")) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}family=IPv4&connect_timeout=30`;
  }
  
  return url;
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;