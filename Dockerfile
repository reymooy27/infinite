FROM node:22-alpine AS base

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY patches/ ./patches/
COPY prisma/ ./prisma/
COPY prisma.config.ts ./
ENV DATABASE_URL=file:/data/infinite.db
RUN npm ci

# --- Build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL=file:/data/infinite.db
RUN npx prisma generate
RUN npm run build

# --- Production ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/infinite.db
ENV PORT=7890
ENV HOSTNAME="0.0.0.0"
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
EXPOSE 7890
# Create the SQLite schema on the shared volume if it does not exist yet.
# `prisma db push` is idempotent, so either container can initialize it.
CMD ["sh", "-c", "npx prisma db push && npx next start -p 7890 -H 0.0.0.0"]
