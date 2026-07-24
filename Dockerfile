FROM node:22-alpine AS base

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY patches/ ./patches/
COPY server/prisma/ ./server/prisma/
COPY server/prisma.config.ts ./server/prisma.config.ts
ENV DATABASE_URL=file:/data/infinite.db
RUN npm ci && npm cache clean --force

# --- Build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL=file:/data/infinite.db
RUN npx prisma generate --schema server/prisma/schema.prisma
RUN npm run build

# --- Production ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/infinite.db
ENV PORT=7890
ENV HOSTNAME="0.0.0.0"

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/server/prisma.config.ts ./server/prisma.config.ts

RUN npm i -g prisma

EXPOSE 7890
CMD prisma db push --schema server/prisma/schema.prisma && npx vite preview --host 0.0.0.0 --port 7890
