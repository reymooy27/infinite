FROM node:20-alpine AS base

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY patches/ ./patches/
COPY prisma/ ./prisma/
COPY prisma.config.ts ./
ENV DATABASE_URL=postgresql://x:x@localhost:5432/x
ENV DIRECT_URL=postgresql://x:x@localhost:5432/x
RUN npm ci

# --- Build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL=postgresql://infinite:infinite@db:5432/infinite
ENV DIRECT_URL=postgresql://infinite:infinite@db:5432/infinite
RUN npx prisma generate
RUN npm run build

# --- Production ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 7890
ENV PORT=7890
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
