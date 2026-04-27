import { useRef, useEffect } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import useWindowStore from '../stores/useWindowStore'

export default function Canvas({ children }) {
  const wrapperRef = useRef(null)
  const contentRef = useRef(null)
  const draggingId = useWindowStore((s) => s.draggingId)
  const focusTargetId = useWindowStore((s) => s.focusTargetId)
  const windows = useWindowStore((s) => s.windows)

  useEffect(() => {
    const tw = wrapperRef.current
    if (!tw) return
    const wrapper = tw.instance?.wrapperComponent
    if (!wrapper) return
    const vw = wrapper.offsetWidth
    const vh = wrapper.offsetHeight
    tw.instance.setState(1, vw / 2 - 5000, vh / 2 - 5000)
  }, [])

  useEffect(() => {
    if (!focusTargetId) return
    const win = windows.find((w) => w.id === focusTargetId)
    if (!win) return

    const tw = wrapperRef.current
    if (!tw) return
    const wrapper = tw.instance?.wrapperComponent
    if (!wrapper) return

    const vw = wrapper.offsetWidth
    const vh = wrapper.offsetHeight

    const winW = win.width || 400
    const winH = win.height || 300
    const winCenterX = win.x + winW / 2
    const winCenterY = win.y + winH / 2

    const scale = tw.instance?.state?.scale || 1

    const tx = vw / 2 - winCenterX * scale
    const ty = vh / 2 - winCenterY * scale

    tw.instance.setState(scale, tx, ty)

    useWindowStore.setState({ focusTargetId: null })
  }, [focusTargetId, windows])

  useEffect(() => {
    const tw = wrapperRef.current
    if (!tw) return
    if (draggingId) {
      tw.instance.setup.panning.disabled = true
      tw.instance.setup.wheel.disabled = true
    } else {
      tw.instance.setup.panning.disabled = false
      tw.instance.setup.wheel.disabled = false
    }
  }, [draggingId])

  useEffect(() => {
    const tw = wrapperRef.current
    if (!tw) return
    tw.instance.setup.velocityAnimation.sensitivityMouse = 0.25
    tw.instance.setup.wheel.step = 0.005
  }, [])

  const isDragging = draggingId !== null

  const gridColor = isDragging ? '#444' : '#333'
  const bgColor = isDragging ? '#1e1e2e' : '#1a1a1a'

  return (
    <TransformWrapper
      ref={wrapperRef}
      initialScale={1}
      minScale={0.4}
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
          ref={contentRef}
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