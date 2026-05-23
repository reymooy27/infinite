FROM node:20-slim

RUN apt-get update && apt-get install -y \
    openssl \
    libssl-dev \
    libssh2-1 \
    libssh2-1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 3001

CMD ["npx", "tsx", "index.ts"]
