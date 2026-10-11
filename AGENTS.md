# AGENTS.md

## Project: Infinite — Spatial UI Dev Tool

### Commands

- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint
- `npx patch-package` — Reapply patches (auto-runs on npm install via postinstall)
- `npm run setup:opencode` — One-time host setup (scripts/install-opencode-hostd.mjs): renders + enables systemd user daemon (127.0.0.1:7890, token auth) so the Docker backend spawns opencode serve on the host; needs `docker compose up -d --force-recreate server` after. Fails with install hint if `opencode` binary missing.

### Git

- Commit after EVERY change, no exceptions. No partial or staged commits — commit all changes in one shot.
- Always create feature branch for feature made and push
- Commit message: conventional commits format, subject ≤50 chars.

### Key Files

- `src/App.jsx` — Main layout: hero + pinned workspace + spacer
- `src/components/Canvas.jsx` — Infinite canvas wrapper
- `src/components/WindowFrame.jsx` — Draggable/resizable window
- `src/apps/registry.tsx` — SSHTerminal component with xterm.js init, touch-to-mouse forwarding, Copy button, tmux shortcuts
- `server/lib/ssh.ts` — SSH server with shell options (TERM type), WebSocket streaming
- `src/stores/useWindowStore.js` — Zustand z-index store
- `vite.config.js` — Vite config with React + Tailwind plugins
- `hostd/opencode-hostd.mjs` — Loopback daemon (127.0.0.1:7890, token auth) that spawns opencode serve on the host for the containerized backend
- `patches/@xterm+xterm+6.0.0.patch` — Link click offset fix
