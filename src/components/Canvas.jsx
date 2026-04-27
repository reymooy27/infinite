import { useRef, useEffect } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import useWindowStore from '../stores/useWindowStore'

export default function Canvas({ children }) {
  const wrapperRef = useRef(null)
  const draggingId = useWindowStore((s) => s.draggingId)

  useEffect(() => {
    const tw = wrapperRef.current
    if (!tw) return
    const { centerView } = tw
    centerView(1)
  }, [])

  const isDragging = draggingId !== null

  const gridColor = isDragging ? '#444' : '#333'
  const bgColor = isDragging ? '#1e1e2e' : '#1a1a1a'

  return (
    <TransformWrapper
      ref={wrapperRef}
      initialScale={1}
      minScale={0.1}
      maxScale={5}
      centerZoomedOut={false}
    >
      <TransformComponent
        wrapperStyle={{
          width: '100%',
          height: '100%',
        }}
      >
        <div
          className="relative"
          style={{
            width: '10000px',
            height: '10000px',
            backgroundSize: '40px 40px',
            backgroundImage:
              `linear-gradient(to right, ${gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`,
            backgroundColor: bgColor,
            transition: 'background-color 0.2s ease',
          }}
        >
          {children}
        </div>
      </TransformComponent>
    </TransformWrapper>
  )
}