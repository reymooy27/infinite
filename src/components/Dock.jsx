import registry from '../apps/registry'
import useWindowStore from '../stores/useWindowStore'

export default function Dock() {
  const windows = useWindowStore((s) => s.windows)
  const placingAppId = useWindowStore((s) => s.placingAppId)
  const setPlacingApp = useWindowStore((s) => s.setPlacingApp)
  const clearPlacing = useWindowStore((s) => s.clearPlacing)
  const focusLastWindow = useWindowStore((s) => s.focusLastWindow)

  const appIds = Object.keys(registry)
  const hasWindows = windows.length > 0

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex gap-2 px-3 py-2 bg-neutral-900/90 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl items-center">
      {appIds.map((appId) => {
        const app = registry[appId]
        const isOpen = windows.some((w) => w.appId === appId)
        const isPlacing = placingAppId === appId
        return (
          <button
            key={appId}
            onClick={() => {
              if (isPlacing) {
                clearPlacing()
              } else {
                setPlacingApp(appId)
              }
            }}
            className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors cursor-pointer group ${
              isPlacing
                ? 'bg-blue-600 text-white'
                : 'hover:bg-neutral-800'
            }`}
            title={app.title}
          >
            <span className="text-2xl leading-none">{app.icon}</span>
            <span className={`text-[10px] transition-colors ${
              isPlacing ? 'text-blue-200' : 'text-neutral-500 group-hover:text-neutral-300'
            }`}>{app.title}</span>
            {isOpen && <span className={`w-1 h-1 rounded-full ${isPlacing ? 'bg-white' : 'bg-blue-400'}`} />}
          </button>
        )
      })}
      {hasWindows && (
        <>
          <div className="w-px h-8 bg-neutral-700 mx-1" />
          <button
            onClick={focusLastWindow}
            className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer group"
            title="Focus last window"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400 group-hover:text-neutral-200">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <span className="text-[10px] text-neutral-500 group-hover:text-neutral-300 transition-colors">Focus</span>
          </button>
        </>
      )}
    </div>
  )
}