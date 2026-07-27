FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY patches/ ./patches/
COPY server/prisma/ ./server/prisma/
COPY server/prisma.config.ts ./server/prisma.config.ts
ENV DATABASE_URL=file:/data/infinite.db
RUN npm ci && npm cache clean --force

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL=file:/data/infinite.db
RUN npx prisma generate --schema server/prisma/schema.prisma
RUN npm run build

FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
