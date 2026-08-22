# Infinite

> Browser-based spatial workspace for developers: infinite canvas, draggable
> SSH terminals, dev browser windows, and project context, all in one
> place.

Infinite is a browser-based spatial workspace for development tools. It gives you an infinite canvas with draggable windows for SSH sessions, notes, a dev browser, and project context.

## What It Does

- Infinite canvas with pan/zoom and persistent window layouts
- SSH connections inside draggable, multi-tab xterm.js windows
- Optional SSH relay **agent** for private networks, Tailscale, or LAN-only hosts
- **Dev browser** (tunnels a localhost port on an SSH host)
- **File transfer** (SFTP upload/download) over a saved SSH connection
- **Docker manager** — control containers/images/volumes on a remote host over SSH
- **System monitor** — btop-style live CPU/memory/swap/network/disk gauges,
  a sortable process table (by CPU or memory, with real RSS in MB/GB), and a
  listening-ports table — kill any process or free a stuck port over SSH
- **Git view** — status tree, diff viewer, and commit/push/pull/stash per project
- **Code editor** — VS Code-like Monaco editor (syntax highlight, autocomplete,
  multi-cursor) with save, git diff overlay, and recursive file filter across
  expanded subfolders
- **9router usage analytics** — read-only dashboard of AI/LLM traffic
  (requests, tokens, cost, breakdown by model/provider/key/endpoint)
  pulled live from a [9router](https://9router.dev) service
- **Notes**, **bookmarks**, and **projects** for project-oriented workspace state
- **Canvas navigation aids** — off-screen window compass and a "next
  terminal" switcher for many open windows
- **Terminal customization** — font size, background color, on-screen
  shortcut buttons, and a configurable mobile quick bar
- **Focus mode** — distraction-free layout with the terminal, git sidebar, and
  Docker toggle
- **tmux support** — auto-attach a persistent tmux session on SSH connect, plus
  on-screen tmux keypad (next/prev window, new, split vertical/horizontal,
  zoom, kill) configurable via Settings
- Mobile **quick bar** and **shortcut drawer** for terminal/tmux key pads
- All state persisted in a local SQLite file — no external database required
- **Docker support** — multi-container setup with nginx frontend + Node.js backend

## Stack

- Vite 8
- React 19
- Tailwind CSS v4
- Express + WebSocket
- Prisma + SQLite
- xterm.js
- ssh2
- Zustand (state management)
- Nginx (production static serving)

## Features

### Canvas & layouts

An infinite, pannable/zoomable canvas. Windows (SSH terminals, browsers, notes,
file transfer, Docker manager) are draggable and resizable. Layout state is
saved automatically and restored on reload.

### SSH terminals

xterm.js terminals over WebSocket to a saved SSH connection. Supports multiple
tabs per window, touch scrolling/selection on mobile, tmux helpers, and
terminal buffer caching across project switches.

### Relay agent

For SSH targets not publicly reachable: a small Node.js process (`agent/`)
runs on a machine with access to the target and bridges the session back over
WebSocket. See [Agent Mode](#agent-mode).

### Dev browser

- Opens a localhost URL *on the SSH host* by tunneling the
  port through the relay, so you can view a dev server running remotely.

### File transfer

SFTP upload/download launched from the Dock. Pairs with a saved SSH connection.

### Docker manager

Full Docker control — list/start/stop/restart/pause/remove/prune containers,
images, volumes, and networks, plus logs and inspect — executed **over SSH**
against a saved connection. Live **`docker stats`** (CPU % / memory) stream
alongside each container. Open it from the Dock, the Focus Mode Docker
toggle, or as a slide-in **Docker panel**.

### System monitor

A btop-style live view of a remote host, over SSH. All metrics are gathered in
a **single SSH round-trip** — `/proc` is sampled twice around a short sleep so
CPU% and network rates are true deltas, not cumulative counters.

- **CPU** — total plus per-core meters, with 1/5/15-min load average
- **Memory & swap** — used/total meters
- **Network** — live rx/tx throughput
- **Disks** — usage per mount point
- **Processes** — top 20, sortable by **CPU** or **memory** (real RSS shown in
  MB/GB, sort runs server-side so the memory list is accurate). Kill any
  process with a graceful **SIGTERM** or a forced **SIGKILL (-9)**.
- **Listening ports** — every TCP/UDP listener (`ss`, falling back to
  `netstat`) with its owning process; kill a process to free a stuck port.

Open it from the Dock, the Focus Mode monitor toggle, or as a slide-in panel.
Process/port ownership for other users' sockets requires privileges on the host.

### Git view

Per active project: working-tree status (staged / unstaged / untracked), a diff
viewer, and stage / unstage / discard / commit / branch / push / pull / stash
actions. Reached via the Focus Mode git toggle.

### Code editor

A Monaco-based editor for the active project's directory:

- **Syntax highlighting**, autocomplete, multi-cursor, and standard Monaco
  keybindings
- **Save** (`⌘S` / `Ctrl+S`) writes back to the remote host over SSH/SFTP
- **Git diff overlay** — toggle a side-by-side diff against `HEAD` to review
  unsaved changes
- **Recursive file filter** — the tree's search box matches file paths inside
  any already-expanded subfolder; when a query is active, matches render as a
  flat list with the full path
- **Persistent session** — open file, unsaved content, expanded folders, and
  cached directory listings survive reloads

### Usage analytics (9router)

A read-only dashboard of AI/LLM API traffic. Infinite does not store
usage itself — it fetches summaries from a running
[9router](https://9router.dev) instance (default
`http://127.0.0.1:20128`, configurable in Settings → **9router usage
source**).

The Usage panel (sidebar → **Usage**) shows:

- totals for the selected period (today / 24h / 7d / 30d / 60d):
  requests, prompt tokens, completion tokens, cached tokens, and
  estimated cost
- a breakdown table grouped by **model**, **provider**, or **API key**
  (plus **endpoint** when present)
- the most recent requests

The same "today" summary also appears at a glance in the Projects
switcher. Point the endpoint at your 9router base URL; Infinite only
reads the summary — the source of truth stays in 9router.

### Dev browser console & viewport

The Dev browser adds two tools on top of the localhost tunnel:

- a **console panel** that captures the remote page's JS console
  (log / warn / error / info), filterable and drag-resizable
- **viewport presets** — desktop, tablet (768px), and mobile (390px)
  — to emulate responsive layouts against the remote dev server

### Terminal customization

In Settings → **Terminal** you can tune the terminal appearance and
mobile UX:

- **font size** (8–24px)
- **background color** (8 presets + custom)
- **terminal button shortcuts** toggle (on-screen control keys, arrows,
  enter/tab)
- **quick bar buttons** — pick which terminal and tmux shortcuts
  (up to 9) show in the mobile quick bar
- **auto tmux session** — automatically attach to a persistent tmux
  session when opening an SSH terminal so reconnecting doesn't lose
  running processes

The mobile **Shortcut drawer** adds a dedicated **Tmux** tab with a full
keypad: next/prev window, new window, split vertical/horizontal, zoom
pane, kill pane.

### Recommended tmux config

For the best experience with Infinite's tmux integration, add this to
`~/.tmux.conf` on the remote host:

```tmux
# Enable mouse (scroll, select panes, resize)
set -g mouse on

# Start windows/panes at 1 (easier for keypad)
set -g base-index 1
setw -g pane-base-index 1

# Renumber windows when one is closed
set -g renumber-windows on

# Increase history limit
set -g history-limit 50000

# Faster escape sequence (helps with vim/nvim)
set -sg escape-time 10

# Better prefix (Ctrl-a instead of Ctrl-b)
unbind C-b
set -g prefix C-a
bind C-a send-prefix

# Split bindings that match Infinite's keypad
bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"

# Pane navigation (vim-style)
bind h select-pane -L
bind j select-pane -D
bind k select-pane -U
bind l select-pane -R

# Reload config
bind r source-file ~/.tmux.conf \; display "Config reloaded"
```

**Why these settings matter for Infinite:**

| Setting | Purpose |
|---------|---------|
| `mouse on` | Touch scroll/selection works in xterm.js |
| `base-index 1` | Window numbers match keypad (1-9) |
| `renumber-windows on` | No gaps after killing windows |
| `escape-time 10` | No delay when pressing Escape in vim |
| `split -c "#{pane_current_path}"` | New panes open in same directory |

The on-screen tmux keypad in Infinite sends these default bindings:
- `Ctrl-a n` / `Ctrl-a p` — next/prev window
- `Ctrl-a c` — new window
- `Ctrl-a |` — split horizontal
- `Ctrl-a -` — split vertical
- `Ctrl-a z` — zoom pane
- `Ctrl-a x` — kill pane

If you change the prefix in tmux, update **Settings → Terminal → Quick bar buttons** accordingly.

### Canvas navigation aids

When many windows are spread across the infinite canvas:

- a **navigation indicator** (compass) appears when the nearest window
  is off-screen — it points in that window's direction, shows the
  distance, and centers the view on click
- a **next terminal** control cycles focus to the next visible SSH
  terminal window
- a **leave-page guard** confirms before navigating away with unsaved
  canvas state

### Projects, notes & bookmarks

- **Projects** group workspace state (canvas + directory) and can be switched
  with Cmd+Shift+P.
- **Notes** are canvas note windows, persisted.
- **Bookmarks** are saved URLs, used as quick-links in the Dev browser.

### Focus mode & mobile UX

- **Focus mode** (Cmd+Shift+F) hides the canvas and shows a single terminal plus
  the git sidebar and the Docker / system-monitor toggles.
- **Quick bar** and **shortcut drawer** surface copy/paste and terminal/tmux/nav
  key pads for touch devices.

### Notifications

Two independent paths, and you may want both:

**Terminal bell — works out of the box.** Claude Code rings the bell (`\x07`)
when it finishes a turn. Infinite forwards that to an OS notification whenever
the tab is in the background. Nothing to configure; just allow notifications
when the browser asks. Only works while a tab is still open.

**Web push — survives a closed tab.** Needs a one-time setup on the server plus
a Stop hook in your own Claude Code config.

1. Generate a VAPID keypair and a shared token:

   ```bash
   npx web-push generate-vapid-keys
   openssl rand -hex 32          # for PUSH_TOKEN
   ```

2. Put them in the server `.env` and restart:

   ```env
   VAPID_PUBLIC_KEY=<public key>
   VAPID_PRIVATE_KEY=<private key>
   VAPID_SUBJECT=mailto:you@example.com
   PUSH_TOKEN=<the hex token>
   ```

   Without `VAPID_*` the push routes stay up but report `enabled: false`, and the
   toggle in Settings reports the missing key instead of failing silently.

3. Open **Settings → Push notifications** and turn it on. This needs a secure
   context: `https://` or `localhost`. On plain HTTP over a LAN IP the browser
   does not expose `PushManager` at all.

4. Add a Stop hook to `~/.claude/settings.json` **on the machine where you run
   `claude`** — that is the SSH remote, not your laptop, so the URL has to be
   reachable from there:

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "jq -c '{title: (\"Claude Code — \" + (.cwd | split(\"/\") | last)), body: ((.last_assistant_message // \"Turn finished\")[0:300])}' | curl -sS -m 5 -X POST http://localhost:7891/api/push/notify -H 'Authorization: Bearer <PUSH_TOKEN>' -H 'Content-Type: application/json' -d @-"
             }
           ]
         }
       ]
     }
   }
   ```

   Claude Code pipes the hook a JSON object on stdin; `jq` turns it into the
   notification payload. `.cwd` becomes the project name (last path segment) and
   `.last_assistant_message` — the final assistant text of the turn — becomes the
   body, so you see *what* was done, not just *that* something finished. The
   `// "Turn finished"` fallback covers Claude Code versions that don't send that
   field. Requires `jq` on the remote.

Both paths use the notification tag `claude-code`, so if a tab happens to be
open you get one notification, not two.

## Quick Start (Docker — recommended)

The fastest way to run Infinite. Two containers: nginx (frontend) + Node.js
(server), sharing a SQLite database on a Docker volume.

### Requirements

- Docker 24+
- Docker Compose v2

### 1. Clone & configure

```bash
git clone https://github.com/your-user/infinite.git
cd infinite
```

Copy the Docker env template and fill in `ENCRYPTION_SECRET`:

```bash
cp .env.docker .env
```

Generate the secret (required — encrypts saved SSH credentials):

```bash
openssl rand -hex 32
```

Paste the output into `.env` as `ENCRYPTION_SECRET`. The file looks like:

```env
# Required — used to encrypt SSH passwords & private keys
ENCRYPTION_SECRET=<paste-here>

# Server
DATABASE_URL=file:/data/infinite.db
WS_PORT=7891
ALLOWED_ORIGINS=http://localhost:9871

# Frontend (build-time, leave empty for local)
VITE_WS_URL=
```

> **Do not lose `ENCRYPTION_SECRET`** — saved SSH credentials cannot be
> recovered without it.

### 2. Build & start

```bash
docker compose up -d --build
```

Open: <http://localhost:9871>

The server container runs `prisma db push` on first start to create the
SQLite schema automatically. No manual database setup needed.

### 3. Verify

```bash
# Check containers are running
docker compose ps

# Check logs
docker compose logs -f server
docker compose logs -f frontend
```

### Architecture

```
┌──────────────────┐       ┌──────────────────┐
│    frontend      │──────▶│     server       │
│  nginx:alpine    │       │  node:22-alpine  │
│  :9871           │       │  :7891           │
└──────────────────┘       └────────┬─────────┘
                                    │
                             ┌──────▼───────┐
                             │  SQLite DB   │
                             │  /data/      │
                             │  (volume)    │
                             └──────────────┘
```

| Container  | Image          | Port  | Role                                    |
| ---------- | -------------- | ----- | --------------------------------------- |
| `frontend` | nginx:alpine   | 9871  | Static files, proxy `/api` & `/ws`      |
| `server`   | node:22-alpine | 7891  | API, WebSocket, SSH, Docker, Git        |
| —          | SQLite volume  | —     | Persistent data (`infinite-data`)       |

### Stop & cleanup

```bash
# Stop containers (data preserved)
docker compose down

# Stop and wipe database
docker compose down -v
```

## Manual Install (local development)

Use this path if you want to run the app directly with Node.js instead of
Docker.

### Requirements

- Node.js 20+
- npm

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
VITE_WS_URL=
ALLOWED_ORIGINS=http://localhost:9871
```

Variable reference:

- `DATABASE_URL`: path to the SQLite database file
- `ENCRYPTION_SECRET`: encrypts saved SSH passwords and private keys
  — **if you lose this, saved credentials cannot be recovered**
- `VITE_WS_URL`: leave empty for local dev; set to your server
  URL when the frontend and WS server run on different origins
- `ALLOWED_ORIGINS`: origins allowed to call the Express/WebSocket server
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` / `PUSH_TOKEN`:
  optional, only for web push — see [Notifications](#notifications)

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

That starts the Vite dev server on `http://localhost:9871` and the
Express/WebSocket server on `http://localhost:7891`. Open
`http://localhost:9871`.

## Build and Lint

```bash
npm run build
npm run lint
```

## Database

Main models in [server/prisma/schema.prisma](/home/rey/project/infinite/server/prisma/schema.prisma:1):

- `Connection`: saved SSH targets and encrypted credentials
- `Layout`: saved canvas/window state
- `Agent`: relay agents for private-network SSH
- `Project`: project workspace state
- `Note`: notes
- `Bookmark`: saved URLs

For local development this app uses a fixed local user id, so no auth setup
is currently required.

Infinite was migrated from Postgres to **SQLite** (Prisma + the
`better-sqlite3` driver adapter) — no external database server is needed
and state lives in a single file. A `scripts/migrate-pg-to-sqlite.mjs`
helper exists for moving an existing Postgres dump into the SQLite schema.

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
3. Leave the route as `Via relay server (public IP)` if the target is publicly
   reachable from the relay server
4. Save and click `Connect`

This opens an SSH terminal window on the canvas.

### 2. Open a browser window

- **Dev browser (localhost tunnel):** on a saved connection, use the `Dev`
  button to open a browser window that tunnels a localhost port on the SSH
  host — handy for viewing a remote dev server. Bookmarks appear as quick-links.

### 3. Transfer files

From the Dock, pick a saved connection and choose upload or download. Transfers
run over SFTP on that SSH connection.

### 4. Manage Docker

Open the Docker manager from the Dock (or the Docker toggle in Focus Mode). It
runs Docker commands **over SSH** against the selected connection — start, stop,
restart, pause, remove, or prune containers, plus images, volumes, networks,
logs, and inspect.

### 5. Use Git

Enter Focus Mode (Cmd+Shift+F), then open the git sidebar. For the active
project you can view the status tree, open a diff, and stage / unstage /
discard / commit / branch / push / pull / stash.

### 6. Projects, notes & bookmarks

- Create and switch **Projects** from the Projects panel or Cmd+Shift+P; each
  project stores its own canvas and working directory.
- Add **Notes** as canvas windows and **Bookmarks** as saved URLs.

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
network, but not reachable from the public server.

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
- `INFINITE_SERVER`: WebSocket base URL for the server, for example
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

## Architecture

This repo runs two app processes in development:

- Next.js frontend on `http://localhost:3000`
- Express/WebSocket server on `http://localhost:7891`

The frontend (Vite + nginx) serves static files and proxies API/WS requests to the server. The Express server handles:

- SSH WebSocket sessions
- localhost tunnels
- agent relay connections
- online agent status checks
- Docker control over SSH
- Git operations for projects

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

- [src/App.tsx](/home/rey/project/infinite/src/App.tsx:1): top-level workspace layout
- [src/components/Canvas.jsx](/home/rey/project/infinite/src/components/Canvas.jsx:1): infinite canvas wrapper
- [src/components/WindowFrame.jsx](/home/rey/project/infinite/src/components/WindowFrame.jsx:1): draggable/resizable window shell
- [src/apps/registry.tsx](/home/rey/project/infinite/src/apps/registry.tsx:1): app registry including SSH terminal wiring
- [src/components/SSHPanel.tsx](/home/rey/project/infinite/src/components/SSHPanel.tsx:1): saved SSH connections UI
- [src/components/AgentPanel.tsx](/home/rey/project/infinite/src/components/AgentPanel.tsx:1): create/list agent UI
- [src/apps/DockerManager.tsx](/home/rey/project/infinite/src/apps/DockerManager.tsx:1): Docker manager window
- [src/components/FocusModeGitPanel.tsx](/home/rey/project/infinite/src/components/FocusModeGitPanel.tsx:1): git status/diff/commit UI
- [src/components/SettingsPanel.tsx](/home/rey/project/infinite/src/components/SettingsPanel.tsx:1): settings + AI API management
- [src/components/FileTransferModal.tsx](/home/rey/project/infinite/src/components/FileTransferModal.tsx:1): SFTP transfer UI
- [server/index.ts](/home/rey/project/infinite/server/index.ts:1): Express + WebSocket server
- [server/lib/ssh.ts](/home/rey/project/infinite/server/lib/ssh.ts:1): SSH session handling and agent proxy logic
- [server/lib/docker.ts](/home/rey/project/infinite/server/lib/docker.ts:1): Docker-over-SSH control
- [agent/index.js](/home/rey/project/infinite/agent/index.js:1): relay agent process

## Deployment

Infinite has three components, plus an optional agent:

| Component  | Process                | Default port | Role                                                              |
| ---------- | ---------------------- | ------------ | ----------------------------------------------------------------- |
| `frontend` | Vite (dev) / Nginx (prod) | `9871`   | UI, static files, API/WS proxy                                    |
| `server`   | Express + WebSocket    | `7891`       | SSH sessions, browser control, agent relay, Docker, Git           |
| `db`       | SQLite file            | n/a          | Persisted state (connections, layouts, notes, projects, AI keys)  |
| `agent`    | Standalone Node.js     | outbound WS  | Optional proxy that runs where the SSH target is reachable        |

The `frontend` and `server` can run on the same host or different hosts.
The `server` is the only component that needs direct network access to
SSH targets. The `frontend` (nginx) serves static files and proxies
`/api` and `/ws` to the server automatically.

For local single-host Docker, see [Quick Start](#quick-start-docker--recommended).
For local single-host Node.js, see [Manual Install](#manual-install-local-development).

### Split Host (frontend and server on different machines)

The frontend and server are independent processes and can run on
separate hosts. Point `VITE_WS_URL` at the public URL of the server.
Run the server on a host that:

- has a stable public address (or is reachable through Tailscale, Cloudflare
  Tunnel, WireGuard, etc.)
- can reach the SSH targets you want to expose

Run the server on a separate machine (VPS, home lab, etc.) with
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

Set `VITE_WS_URL` in the frontend environment to
`wss://server.example.com`. If the server host is behind Tailscale, use the
Tailscale hostname so both ends speak over the tailnet.

> Note: in a split-host setup each host gets its own SQLite file unless they
> share a disk or volume. For a single-host Docker Compose deploy the file is
> shared automatically via the `sqlite_data` volume.

### Reverse Proxy (nginx example)

A minimal nginx config that fronts the frontend on `443` and proxies
WebSocket upgrades to the server on `7891`:

```nginx
server {
  listen 443 ssl http2;
  server_name infinite.example.com;

  ssl_certificate     /etc/letsencrypt/live/infinite.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/infinite.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:9871;
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
`vite preview` and the server under PM2 or systemd on a single host. Edit
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
