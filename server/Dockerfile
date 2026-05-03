FROM node:20-slim

# Install system dependencies for ssh2 + puppeteer (chromium) + tailscale
RUN apt-get update && apt-get install -y \
    # ssh2 deps
    openssl \
    libssl-dev \
    libssh2-1 \
    libssh2-1-dev \
    # Chromium deps for puppeteer
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    curl \
    gnupg \
    iptables \
    && rm -rf /var/lib/apt/lists/*

# Install Tailscale
RUN curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null \
    && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list | tee /etc/apt/sources.list.d/tailscale.list >/dev/null \
    && apt-get update \
    && apt-get install -y tailscale \
    && rm -rf /var/lib/apt/lists/*

# Tailscale state directory (mounted from Fly volume)
RUN mkdir -p /data

WORKDIR /app

COPY package.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

# Make startup script executable
RUN chmod +x start.sh

EXPOSE 3001

# /dev/net/tun needed by tailscale
# --cap-add=NET_ADMIN + device mapping handled by fly.toml
CMD ["./start.sh"]