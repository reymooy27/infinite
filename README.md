# Infinite — Spatial UI Dev Tool

A browser-based workspace with an infinite canvas, draggable windows, and integrated developer tools.

## Features

- **Infinite Canvas** — Pan and zoom across a 10000x10000 workspace
- **Window System** — Draggable and resizable windows with macOS-style controls
- **Built-in Apps** — Notes, Code Editor, Terminal, Browser, SSH Client
- **Real Browser** — Remote-controlled Chromium via Puppeteer WebSocket
- **SSH Terminal** — Full terminal sessions with xterm.js
- **Layout Persistence** — Window positions saved to PostgreSQL

## Stack

- **Next.js 16** (App Router)
- **Tailwind CSS v4**
- **Zustand** — Window focus / z-index state
- **GSAP + ScrollTrigger** — Animation
- **react-zoom-pan-pinch** — Infinite canvas
- **react-rnd** — Draggable/resizable windows
- **xterm.js** — SSH terminal emulator
- **Puppeteer** — Headless browser for remote browsing
- **Prisma** — PostgreSQL ORM

## Architecture

```
app/                    Next.js frontend
├── App.tsx             Root layout + window orchestration
├── page.tsx            Root page
├── api/                API routes (layout, ssh connections)
├── layout.tsx          Metadata, fonts
└── globals.css         Tailwind v4 + custom fonts

src/
├── apps/registry.tsx   App definitions (CodeEditor, Terminal, Notes, Browser, SSH)
├── components/
│   ├── Canvas.tsx       Infinite canvas + zoom controls
│   ├── WindowFrame.tsx  Draggable/resizable window chrome
│   ├── Dock.tsx         Bottom dock with app icons
│   ├── Sidebar.tsx      SSH connection panel
│   └── ...
├── stores/
│   ├── useWindowStore.ts   Window state (open/close/minimize/maximize/restore)
│   └── useSSHStore.ts     SSH connection state
├── types/index.ts         TypeScript types
└── lib/                   Utilities (encryption, prisma, logger)

server/                 Custom Node.js server
├── index.ts            Express + WebSocket (port 3001)
└── lib/
    ├── ssh.ts          SSH session management via ssh2
    └── browser.ts      Puppeteer browser pool

prisma/
└── schema.prisma       PostgreSQL schema (Connection, Layout models)
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and WS_URL

# Run database migrations
npx prisma migrate dev

# Start development
npm run dev
```

The development command (`npm run dev`) runs both Next.js dev server and the WebSocket server concurrently.

### Environment Variables

| Variable       | Description                     | Default               |
| -------------- | ------------------------------- | --------------------- |
| `DATABASE_URL` | PostgreSQL connection string    | `postgresql://...`    |
| `WS_URL`       | WebSocket server URL (optional) | `ws://localhost:7891` |

## App Descriptions

| App             | Description                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| **Notes**       | Simple notepad                                                                |
| **Code Editor** | Text editor with line numbers                                                 |
| **Terminal**    | Simulated terminal (date, whoami, ls, neofetch, clear, help)                  |
| **Browser**     | Remote Chromium via Puppeteer; supports URL bar, navigation, scroll, keyboard |
| **SSH**         | Real SSH sessions via xterm.js + WebSocket                                    |

## Window Operations

- **Drag** title bar to move
- **Resize** corners/edges
- **Traffic lights** — minimize (yellow), maximize (green), close (red)
- **Zoom** — Ctrl+scroll or use zoom controls (top-left of canvas)
- **Pan** — Middle-mouse drag or Ctrl+arrow keys

## Database Schema

### Connection

Stores SSH connection credentials (encrypted via AES-256-GCM).

| Field                 | Type    | Description           |
| --------------------- | ------- | --------------------- |
| `id`                  | Int     | Primary key           |
| `name`                | String  | Display name          |
| `host`                | String  | SSH host              |
| `port`                | Int     | SSH port (default 22) |
| `username`            | String  | SSH username          |
| `authType`            | String  | "password" or "key"   |
| `passwordEncrypted`   | String? | Encrypted password    |
| `privateKeyEncrypted` | String? | Encrypted private key |

### Layout

Stores window layout state (position, size, z-index, maximized/minimized flags).

## Scripts

```bash
npm run dev          # Start dev server + WebSocket server
npm run build         # Production build
npm run lint          # ESLint
npx prisma studio     # Database GUI
npx prisma migrate   # Run migrations
```

