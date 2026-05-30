# AGENTS.md

## Project: Infinite — Spatial UI Dev Tool

### Stack
- Vite + React 19
- Tailwind CSS v4 (via @tailwindcss/vite plugin)
- GSAP + ScrollTrigger (scroll-to-pin animation)
- react-zoom-pan-pinch (infinite canvas)
- react-rnd (draggable + resizable windows)
- Zustand (window focus / z-index state)

### Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint
- `npx patch-package` — Reapply patches (auto-runs on npm install via postinstall)

### Git
- Commit after EVERY change, no exceptions. No partial or staged commits — commit all changes in one shot.
- Always push to `origin/master` after every commit.
- Commit message: conventional commits format, subject ≤50 chars.

### Architecture

**Scroll Pinning**: GSAP ScrollTrigger pins `#workspace-container` when it reaches the viewport top. A `#workspace-spacer` div after it provides scroll duration. The pin uses `pinSpacing: false` so height is manually controlled.

**Infinite Canvas**: `Canvas` component wraps content in `TransformWrapper` / `TransformComponent` from react-zoom-pan-pinch. The inner area is a 10000x10000px div with a CSS grid background.

**Window Frames**: `WindowFrame` uses `react-rnd` for drag+resize. Props: `id`, `title`, `children`, `defaultX/Y/Width/Height`. Has a macOS-style header bar with traffic-light dots and a content area.

**Focus System**: Zustand store at `src/stores/useWindowStore.js`. `bringToFront(id)` increments a global `topZ` counter and assigns it to the window. Windows register/unregister on mount/unmount.

### Patches
- `patches/@xterm+xterm+6.0.0.patch` — Two fixes in xterm.js Mouse.ts:
  1. **Cell boundary fix**: `Math.ceil` → `Math.floor(...)+1` in `getCoords`. `Math.ceil` maps clicks at exact cell boundaries to the previous row, making the user click slightly below the target.
  2. **CSS transform scale fix**: `getCoordsRelativeToElement` now divides pixel coords by `(boundingRect.width / offsetWidth)` to undo CSS transforms from parent zoom. Without this, canvas zoom (react-zoom-pan-pinch) makes pixel positions live in transformed space while cell dimensions stay in pre-transform space, causing offset proportional to zoom level.
  Applied via `patch-package` on postinstall.

### Key Files
- `src/App.jsx` — Main layout: hero + pinned workspace + spacer
- `src/components/Canvas.jsx` — Infinite canvas wrapper
- `src/components/WindowFrame.jsx` — Draggable/resizable window
- `src/apps/registry.tsx` — SSHTerminal component with xterm.js init, touch-to-mouse forwarding, Copy button, tmux shortcuts
- `server/lib/ssh.ts` — SSH server with shell options (TERM type), WebSocket streaming
- `src/stores/useWindowStore.js` — Zustand z-index store
- `vite.config.js` — Vite config with React + Tailwind plugins
- `patches/@xterm+xterm+6.0.0.patch` — Link click offset fix