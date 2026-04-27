import registry from '../apps/registry'
import useWindowStore from '../stores/useWindowStore'

export default function Dock() {
  const windows = useWindowStore((s) => s.windows)
  const openApp = useWindowStore((s) => s.openApp)

  const appIds = Object.keys(registry)

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex gap-2 px-3 py-2 bg-neutral-900/90 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl">
      {appIds.map((appId) => {
        const app = registry[appId]
        const isOpen = windows.some((w) => w.appId === appId)
        return (
          <button
            key={appId}
            onClick={() => openApp(appId)}
            className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer group"
            title={app.title}
          >
            <span className="text-2xl leading-none">{app.icon}</span>
            <span className="text-[10px] text-neutral-500 group-hover:text-neutral-300 transition-colors">{app.title}</span>
            {isOpen && <span className="w-1 h-1 rounded-full bg-blue-400" />}
          </button>
        )
      })}
    </div>
  )
}