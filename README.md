# Infinite

> Browser-based spatial workspace for developers: infinite canvas, draggable
> SSH terminals, remote browser windows, and project context, all in one
> place.

Infinite is a browser-based spatial workspace for development tools. It gives you an infinite canvas with draggable windows for SSH sessions, notes, a remote browser, and project context.

## What It Does

- Infinite canvas with pan/zoom and persistent window layouts
- SSH connections inside draggable xterm.js windows
- Optional SSH relay agent for private networks, Tailscale, or LAN-only hosts
- Remote browser windows backed by Puppeteer
- Notes and project-oriented workspace state stored in a local SQLite file

## Stack

- Next.js 16
- React 19
- Tailwind CSS v4
- Express + WebSocket
- Prisma + SQLite
- xterm.js
- ssh2
- Puppeteer

## Quick Start (Docker — recommended)

The fastest way to try Infinite. Runs the frontend and relay server in one
command. State lives in a local SQLite file — no separate database container
is needed:

```bash
docker compose up -d --build
```

Open: <http://localhost:7890>

Ports:

- frontend: `http://localhost:7890`
- relay server: `http://localhost:7891`

Both containers share a single SQLite database file on a Docker volume
(`sqlite_data`). The schema is created automatically on startup via
`prisma db push`, so no `.env` file is required for the Docker setup.

Stop the stack:

```bash
docker compose down
```

Wipe the database volume too:

```bash
docker compose down -v
```

## Manual Install (local development)

Use this path if you want to run the app directly with Node.js instead of
Docker.

### Requirements

- Node.js 20+
- npm

> Note: `npm install` downloads Puppeteer's bundled Chromium (~300 MB). If
> you're on Alpine, behind a strict proxy, or low on disk, see
> [Puppeteer troubleshooting](#puppeteer-troubleshooting) below.

### 1. Configure environment

```bash
cp .env.example .env
```

Generate a 64-character hex secret for encrypting saved SSH credentials:

```bash
openssl rand -hex 32
```

Put the output in `.env` as `ENCRYPTION_SECRET`. A complete `.env` looks
like:

```env
DATABASE_URL=file:./infinite.db
ENCRYPTION_SECRET=<paste-your-generated-secret-here>
NEXT_PUBLIC_WS_URL=
ALLOWED_ORIGINS=http://localhost:3000
```

Variable reference:

- `DATABASE_URL`: path to the SQLite database file
- `ENCRYPTION_SECRET`: encrypts saved SSH passwords and private keys
  — **if you lose this, saved credentials cannot be recovered**
- `NEXT_PUBLIC_WS_URL`: leave empty for local dev; set to your relay server
  URL when the frontend and WS server run on different origins
- `ALLOWED_ORIGINS`: origins allowed to call the Express/WebSocket server

### 2. Set up the database

Infinite uses a local SQLite file (default `./infinite.db`, created next to
the Prisma schema). No external database server is required — `npm run
db:push` below creates the schema automatically. To use a different location,
set `DATABASE_URL=file:/path/to/infinite.db` in `.env`.

### 3. Install dependencies and push the schema

```bash
npm install
npm run db:push
```

`npm install` also runs `patch-package` and `prisma generate` via
`postinstall`, so you don't need to run them manually.

### 4. Run the app

```bash
npm run dev
```

That starts the Next.js frontend on `http://localhost:3000` and the
Express/WebSocket relay server on `http://localhost:7891`. Open
`http://localhost:3000`.

## Build and Lint

```bash
npm run build
npm run lint
```

## Database

Main models in [prisma/schema.prisma](/home/rey/project/infinite/prisma/schema.prisma:1):

- `Connection`: saved SSH targets and encrypted credentials
- `Layout`: saved canvas/window state
- `Agent`: relay agents for private-network SSH
- `Project`: project workspace state
- `Note`: notes
- `Bookmark`: saved URLs

For local development this app uses a fixed local user id, so no auth setup
is currently required.

## How To Use

### 1. Add an SSH connection

In the SSH panel:

1. Click `Add Connection`
2. Fill in:
   - name
   - host
   - port
   - username
   - auth method: password or private key
3. Leave the route as `Via Fly server (public IP)` if the target is publicly
   reachable from the relay server
4. Save and click `Connect`

This opens an SSH terminal window on the canvas.

### 2. Use the remote browser

If a saved connection supports it, use the `Dev` button beside that SSH
connection to open the browser window attached to the same backend
connection.

## Agent Mode

The agent exists for SSH targets that are not publicly reachable.

Examples:

- a machine on your home LAN
- a private cloud VM
- a host only reachable through Tailscale or another VPN

### How Agent Mode Works

Without an agent:

- the server connects directly to `host:port`

With an agent:

- a small Node.js process runs on a machine that can reach the private host
- that process connects back to Infinite over WebSocket
- Infinite tells that process to open the SSH session on its behalf

### When To Use It

Use an agent when the SSH target is reachable from your machine or private
network, but not reachable from the public relay server.

### Create an Agent

In the Agent panel:

1. Click `Create Agent`
2. Copy the generated command
3. Run that command on the machine that has network access to the target
   host

The command looks like:

```bash
INFINITE_TOKEN=... INFINITE_SERVER=ws://localhost:7891 node agent/index.js
```

When connected successfully, the agent will show as `online`.

### Run the Agent Manually

You can also run it yourself from this repo:

```bash
cd agent
npm install
INFINITE_TOKEN=your-token INFINITE_SERVER=ws://localhost:7891 node index.js
```

Required environment variables:

- `INFINITE_TOKEN`: generated by the app when you create the agent
- `INFINITE_SERVER`: WebSocket base URL for the relay server, for example
  `ws://localhost:7891` or `wss://your-domain`

### Use an Agent for a Connection

When creating an SSH connection, choose:

```text
Via agent: <agent name>
```

instead of the default direct route.

Important:

- the `host` field must be resolvable from the machine running the agent
- the agent machine must itself be able to reach the SSH target

## Puppeteer troubleshooting

`npm install` pulls Puppeteer, which downloads a bundled Chromium build. If
it fails:

- Disk full or low memory: Puppeteer needs ~300 MB free.
- Behind a proxy: set `HTTPS_PROXY` and `PUPPETEER_DOWNLOAD_BASE_URL` to a
  mirror.
- Don't want Chromium downloaded: set `PUPPETEER_SKIP_DOWNLOAD=true` in
  `.env`. The remote browser feature will not work until Chromium is
  installed manually.
- Need a system Chrome: set
  `PUPPETEER_EXECUTABLE_PATH=/path/to/chrome` in `.env`.

## Architecture

This repo runs two app processes in development:

- Next.js frontend on `http://localhost:3000`
- Express/WebSocket server on `http://localhost:7891`

The frontend handles UI and local API routes. The Express server handles:

- SSH WebSocket sessions
- Browser session control
- agent relay connections
- online agent status checks

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run db:push
npm run db:migrate
npm run db:studio
```

## Important Files

- [src/App.jsx](/home/rey/project/infinite/src/App.jsx:1): top-level workspace layout
- [src/components/Canvas.jsx](/home/rey/project/infinite/src/components/Canvas.jsx:1): infinite canvas wrapper
- [src/components/WindowFrame.jsx](/home/rey/project/infinite/src/components/WindowFrame.jsx:1): draggable/resizable window shell
- [src/apps/registry.tsx](/home/rey/project/infinite/src/apps/registry.tsx:1): app registry including SSH terminal wiring
- [src/components/SSHPanel.tsx](/home/rey/project/infinite/src/components/SSHPanel.tsx:1): saved SSH connections UI
- [src/components/AgentPanel.tsx](/home/rey/project/infinite/src/components/AgentPanel.tsx:1): create/list agent UI
- [server/index.ts](/home/rey/project/infinite/server/index.ts:1): Express + WebSocket relay server
- [server/lib/ssh.ts](/home/rey/project/infinite/server/lib/ssh.ts:1): SSH session handling and agent proxy logic
- [agent/index.js](/home/rey/project/infinite/agent/index.js:1): relay agent process

## Deployment

Infinite has three components, plus an optional agent:

| Component  | Process                | Default port | Role                                                              |
| ---------- | ---------------------- | ------------ | ----------------------------------------------------------------- |
| `frontend` | Next.js 16 (App Router) | `3000` (dev) / `7890` (docker) | UI, API routes, Prisma client                  |
| `server`   | Express + WebSocket    | `7891`       | SSH sessions, browser control, agent relay, status checks         |
| `db`       | SQLite file            | n/a          | Persisted state (connections, layouts, notes, projects, agents)   |
| `agent`    | Standalone Node.js     | outbound WS  | Optional proxy that runs where the SSH target is reachable        |

The `frontend` and `server` can run on the same host or different hosts.
The `server` is the only component that needs direct network access to
SSH targets. The `frontend` only talks to the `server` over HTTP and
WebSocket.

For local single-host Docker, see [Quick Start](#quick-start-docker--recommended).
For local single-host Node.js, see [Manual Install](#manual-install-local-development).

### Split Host (frontend and server on different machines)

The frontend and relay server are independent processes and can run on
separate hosts. Point `NEXT_PUBLIC_WS_URL` at the public URL of the relay
server. Run the relay server on a host that:

- has a stable public address (or is reachable through Tailscale, Cloudflare
  Tunnel, WireGuard, etc.)
- can reach the SSH targets you want to expose

Run the relay server on a separate machine (VPS, home lab, etc.) with
`Dockerfile.server`. The example runs on port `7891`:

```bash
docker build -f Dockerfile.server -t infinite-server .
docker run -d \
  --name infinite-server \
  -p 7891:7891 \
  -e DATABASE_URL=file:/data/infinite.db \
  -e ENCRYPTION_SECRET=... \
  -e PORT=7891 \
  -e ALLOWED_ORIGINS=https://your-frontend.example.com \
  infinite-server
```

Set `NEXT_PUBLIC_WS_URL` in the frontend environment to
`wss://relay.example.com`. If the relay host is behind Tailscale, use the
Tailscale hostname so both ends speak over the tailnet.

> Note: in a split-host setup each host gets its own SQLite file unless they
> share a disk or volume. For a single-host Docker Compose deploy the file is
> shared automatically via the `sqlite_data` volume.

### Reverse Proxy (nginx example)

A minimal nginx config that fronts the frontend on `443` and proxies
WebSocket upgrades to the relay on `7891`:

```nginx
server {
  listen 443 ssl http2;
  server_name infinite.example.com;

  ssl_certificate     /etc/letsencrypt/live/infinite.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/infinite.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:7890;
  }

  location /ws/ {
    proxy_pass http://127.0.0.1:7891;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
  }
}
```

Adapt the WebSocket path prefix to whatever `server/index.ts` listens on.

### Systemd (single host)

`infinite.service` and `ecosystem.config.cjs` are provided for running
`next start` and the relay under PM2 or systemd on a single host. Edit
`infinite.service` to match your install path and user before enabling it:

```bash
sudo cp infinite.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now infinite
```

## Security Notes

- Infinite is currently a single-user app. There is no auth flow; it
  assumes it is running on a trusted network or behind a reverse proxy that
  handles authentication.
- SSH credentials (passwords and private keys) are encrypted at rest with
  `ENCRYPTION_SECRET`. Treat that secret like a database password: if you
  lose it, saved credentials cannot be recovered.
- The relay server can open arbitrary TCP connections to any host you
  configure. Restrict network access to the relay (firewall, Tailscale
  ACL, Cloudflare Tunnel policy) so only trusted clients can reach it.
