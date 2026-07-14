# AGENTS.md

## Project: Infinite — Spatial UI Dev Tool

### Commands

- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint
- `npx patch-package` — Reapply patches (auto-runs on npm install via postinstall)

### Git

- Commit after EVERY change, no exceptions. No partial or staged commits — commit all changes in one shot.
- Always push to `origin/master` after every commit.
- Commit message: conventional commits format, subject ≤50 chars.

### Key Files

- `src/App.jsx` — Main layout: hero + pinned workspace + spacer
- `src/components/Canvas.jsx` — Infinite canvas wrapper
- `src/components/WindowFrame.jsx` — Draggable/resizable window
- `src/apps/registry.tsx` — SSHTerminal component with xterm.js init, touch-to-mouse forwarding, Copy button, tmux shortcuts
- `server/lib/ssh.ts` — SSH server with shell options (TERM type), WebSocket streaming
- `src/stores/useWindowStore.js` — Zustand z-index store
- `vite.config.js` — Vite config with React + Tailwind plugins
- `patches/@xterm+xterm+6.0.0.patch` — Link click offset fix
