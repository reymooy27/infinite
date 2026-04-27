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

### Architecture

**Scroll Pinning**: GSAP ScrollTrigger pins `#workspace-container` when it reaches the viewport top. A `#workspace-spacer` div after it provides scroll duration. The pin uses `pinSpacing: false` so height is manually controlled.

**Infinite Canvas**: `Canvas` component wraps content in `TransformWrapper` / `TransformComponent` from react-zoom-pan-pinch. The inner area is a 10000x10000px div with a CSS grid background.

**Window Frames**: `WindowFrame` uses `react-rnd` for drag+resize. Props: `id`, `title`, `children`, `defaultX/Y/Width/Height`. Has a macOS-style header bar with traffic-light dots and a content area.

**Focus System**: Zustand store at `src/stores/useWindowStore.js`. `bringToFront(id)` increments a global `topZ` counter and assigns it to the window. Windows register/unregister on mount/unmount.

### Key Files
- `src/App.jsx` — Main layout: hero + pinned workspace + spacer
- `src/components/Canvas.jsx` — Infinite canvas wrapper
- `src/components/WindowFrame.jsx` — Draggable/resizable window
- `src/stores/useWindowStore.js` — Zustand z-index store
- `vite.config.js` — Vite config with React + Tailwind plugins