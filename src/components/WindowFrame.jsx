import { useCallback, useState } from 'react'
import { Rnd } from 'react-rnd'
import useWindowStore from '../stores/useWindowStore'

const MIN_WIDTH = 200
const MIN_HEIGHT = 150

export default function WindowFrame({ id, title, children, defaultX = 50, defaultY = 50, defaultWidth = 400, defaultHeight = 300 }) {
  const windows = useWindowStore((s) => s.windows)
  const bringToFront = useWindowStore((s) => s.bringToFront)
  const closeWindow = useWindowStore((s) => s.closeWindow)
  const setDragging = useWindowStore((s) => s.setDragging)
  const clearDragging = useWindowStore((s) => s.clearDragging)

  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)

  const win = windows.find((w) => w.id === id)
  const z = win?.z ?? 1

  const handleFocus = useCallback(() => {
    bringToFront(id)
  }, [id, bringToFront])

  const activeClass = isDragging || isResizing
    ? 'border-blue-500/80 shadow-[0_0_30px_rgba(59,130,246,0.3)] scale-[1.002]'
    : 'border-neutral-700 shadow-2xl'

  return (
    <Rnd
      default={{
        x: defaultX,
        y: defaultY,
        width: defaultWidth,
        height: defaultHeight,
      }}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      style={{ zIndex: z }}
      onMouseDown={handleFocus}
      onDragStart={() => { setIsDragging(true); setDragging(id) }}
      onDragStop={() => { setIsDragging(false); clearDragging() }}
      onResizeStart={() => { setIsResizing(true); setDragging(id) }}
      onResizeStop={() => { setIsResizing(false); clearDragging() }}
      className={`flex flex-col rounded-lg overflow-hidden bg-neutral-900 border transition-[border-color,box-shadow] duration-150 ${activeClass}`}
    >
      <div className="flex items-center h-9 px-3 bg-neutral-800 border-b border-neutral-700 cursor-grab select-none shrink-0">
        <div className="flex gap-1.5 mr-3">
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