import { useState, useRef, useEffect } from 'react'

export default function Terminal() {
  const [lines, setLines] = useState([
    { type: 'output', text: '\x1b[32m~ $ welcome to infinite terminal\x1b[0m' },
  ])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const focusInput = () => inputRef.current?.focus()

  const handleSubmit = (e) => {
    e.preventDefault()
    const cmd = input.trim()
    const newLines = [...lines, { type: 'prompt', text: `~ $ ${cmd}` }]

    if (cmd === 'clear') {
      setLines([])
      setInput('')
      setHistory((h) => cmd ? [...h, cmd] : h)
      return
    } else if (cmd === 'help') {
      newLines.push({ type: 'output', text: 'Commands: help, clear, echo <msg>, date, whoami, ls, pwd, cat <file>' })
    } else if (cmd.startsWith('echo ')) {
      newLines.push({ type: 'output', text: cmd.slice(5) })
    } else if (cmd === 'date') {
      newLines.push({ type: 'output', text: new Date().toString() })
    } else if (cmd === 'whoami') {
      newLines.push({ type: 'output', text: 'infinite-user' })
    } else if (cmd === 'pwd') {
      newLines.push({ type: 'output', text: '/home/infinite-user' })
    } else if (cmd === 'ls') {
      newLines.push({ type: 'output', text: '\x1b[34mbin\x1b[0m  \x1b[34mdev\x1b[0m  \x1b[34metc\x1b[0m  \x1b[34mhome\x1b[0m  \x1b[34musr\x1b[0m  \x1b[34mvar\x1b[0m' })
    } else if (cmd === 'neofetch') {
      newLines.push({ type: 'output', text: [
        '\x1b[36m       ___       \x1b[0m  \x1b[36minfinite-user\x1b[0m@\x1b[36minfinite\x1b[0m',
        '\x1b[36m      /   \\      \x1b[0m  OS: Infinite OS',
        '\x1b[36m     /  ___  \\      \x1b[0m  Kernel: spatial-ui',
        '\x1b[36m    /  /   \\  \\    \x1b[0m  Shell: infinite-term',
        '\x1b[36m   /  /     \\  \\   \x1b[0m  Resolution: infinite',
        '\x1b[36m  /  /       \\  \\  \x1b[0m  Theme: dark',
        '\x1b[36m /__/         \\__\\ \x1b[0m  Terminal: infinite-term',
      ].join('\n') })
    } else if (cmd.startsWith('cat ')) {
      newLines.push({ type: 'output', text: `cat: ${cmd.slice(4)}: No such file or directory` })
    } else if (cmd) {
      newLines.push({ type: 'error', text: `zsh: command not found: ${cmd}` })
    }

    setLines(cmd ? newLines : [...lines, { type: 'prompt', text: '~ $' }])
    setInput('')
    if (cmd) setHistory((h) => [...h, cmd])
    setHistIdx(-1)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const newIdx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(newIdx)
      setInput(history[newIdx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx === -1) return
      const newIdx = histIdx + 1
      if (newIdx >= history.length) {
        setHistIdx(-1)
        setInput('')
      } else {
        setHistIdx(newIdx)
        setInput(history[newIdx])
      }
    }
  }

  return (
    <div
      className="flex flex-col h-full font-mono text-[13px] leading-[1.5] bg-[#0d1117] rounded overflow-hidden"
      onClick={focusInput}
    >
      <div className="flex-1 overflow-auto p-2 pb-0">
        {lines.map((line, i) => (
          <div key={i} className={
            line.type === 'prompt' ? 'text-[#79c0ff]' :
            line.type === 'error' ? 'text-[#f85149]' :
            'text-[#8b949e]'
          }>
            {line.text}
          </div>
        ))}
        <form onSubmit={handleSubmit} className="flex items-center text-[#79c0ff]">
          <span className="mr-1 shrink-0 select-none">~ $</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none text-[#c9d1d9] caret-[#4fc3f7]"
            autoFocus
            spellCheck={false}
          />
        </form>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}