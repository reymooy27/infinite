import { useCallback, useState, useRef } from 'react'
import { Rnd } from 'react-rnd'
import { useWindowStore as useStore } from '../stores/useWindowStore'

const MIN_WIDTH = 200
const MIN_HEIGHT = 150

const DragIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" className="text-neutral-500 shrink-0">
    <circle cx="3.5" cy="3.5" r="1.3" />
    <circle cx="10.5" cy="3.5" r="1.3" />
    <circle cx="3.5" cy="10.5" r="1.3" />
    <circle cx="10.5" cy="10.5" r="1.3" />
    <circle cx="3.5" cy="7" r="1.3" />
    <circle cx="10.5" cy="7" r="1.3" />
  </svg>
)

export default function WindowFrame({ id, title, children, defaultX = 50, defaultY = 50, defaultWidth = 400, defaultHeight = 300 }) {
  const windows = useStore((s) => s.windows)
  const bringToFront = useStore((s) => s.bringToFront)
  const closeWindow = useStore((s) => s.closeWindow)
  const setDragging = useStore((s) => s.setDragging)
  const clearDragging = useStore((s) => s.clearDragging)
  const updateWindowPosition = useStore((s) => s.updateWindowPosition)
  const focusWindow = useStore((s) => s.focusWindow)

  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const frameRef = useRef(null)

  const win = windows.find((w) => w.id === id)
  const z = win?.z ?? 1

  const handleDragStart = useCallback(() => {
    setIsDragging(true)
    setDragging(id)
    bringToFront(id)
  }, [id, bringToFront, setDragging])

  const handleDragStop = useCallback((e, d) => {
    setIsDragging(false)
    updateWindowPosition(id, d.x, d.y, d.width, d.height)
    setTimeout(() => clearDragging(), 50)
  }, [id, updateWindowPosition, clearDragging])

  const handleResizeStop = useCallback((e, dir, ref, d) => {
    setIsResizing(false)
    updateWindowPosition(id, d.x, d.y, d.width, d.height)
    setTimeout(() => clearDragging(), 50)
  }, [id, updateWindowPosition, clearDragging])

  const handleResizeStart = useCallback(() => {
    setIsResizing(true)
    setDragging(id)
    bringToFront(id)
  }, [id, bringToFront, setDragging])

  const handleHeaderPointerDown = useCallback((e) => {
    e.stopPropagation()
  }, [])

  const handleDoubleClick = useCallback(() => {
    focusWindow(id)
  }, [id, focusWindow])

  const activeClass = isDragging || isResizing
    ? 'border-blue-500/80 shadow-[0_0_30px_rgba(59,130,246,0.3)] scale-[1.002]'
    : 'border-neutral-700 shadow-2xl'

  return (
    <Rnd
      ref={frameRef}
      default={{
        x: win?.x ?? defaultX,
        y: win?.y ?? defaultY,
        width: win?.width || defaultWidth,
        height: win?.height || defaultHeight,
      }}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      style={{ zIndex: z }}
      dragHandleClassName="window-drag-handle"
      enableResizing={{
        bottomRight: true,
        bottomLeft: true,
        topRight: true,
        topLeft: true,
        right: true,
        left: true,
        bottom: true,
        top: true,
      }}
      onDragStart={handleDragStart}
      onDragStop={handleDragStop}
      onResizeStart={handleResizeStart}
      onResizeStop={handleResizeStop}
      className={`flex flex-col rounded-lg overflow-hidden bg-neutral-900 border transition-[border-color,box-shadow] duration-150 ${activeClass}`}
    >
      <div
        className="window-drag-handle flex items-center h-10 px-3 bg-neutral-800 border-b border-neutral-700 cursor-grab select-none shrink-0 active:cursor-grabbing active:bg-neutral-700"
        onPointerDown={handleHeaderPointerDown}
        onDoubleClick={handleDoubleClick}
      >
        <DragIcon />
        <div className="flex gap-1.5 mx-3">
          <button
            onClick={(e) => { e.stopPropagation(); closeWindow(id) }}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 cursor-pointer"
          />
          <span className="w-3 h-3 rounded-full bg-yellow-500" />
          <span className="w-3 h-3 rounded-full bg-green-500" />
        </div>
        <span className="text-sm text-neutral-300 font-medium truncate">{title}</span>
      </div>
      <div className="flex-1 overflow-auto p-3 text-neutral-200">
        {children}
      </div>
    </Rnd>
  )
}