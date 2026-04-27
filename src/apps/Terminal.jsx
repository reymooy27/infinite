import { useState } from 'react'

export default function Terminal() {
  const [lines, setLines] = useState([
    { type: 'output', text: '~ $ welcome to infinite terminal' },
  ])
  const [input, setInput] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const cmd = input.trim()
    const newLines = [...lines, { type: 'input', text: `~ $ ${cmd}` }]

    if (cmd === 'clear') {
      setLines([{ type: 'output', text: '~ $' }])
    } else if (cmd === 'help') {
      newLines.push({ type: 'output', text: 'Commands: help, clear, echo <msg>, date, whoami' })
      setLines(newLines)
    } else if (cmd.startsWith('echo ')) {
      newLines.push({ type: 'output', text: cmd.slice(5) })
      setLines(newLines)
    } else if (cmd === 'date') {
      newLines.push({ type: 'output', text: new Date().toString() })
      setLines(newLines)
    } else if (cmd === 'whoami') {
      newLines.push({ type: 'output', text: 'infinite-user' })
      setLines(newLines)
    } else if (cmd) {
      newLines.push({ type: 'output', text: `command not found: ${cmd}` })
      setLines(newLines)
    } else {
      setLines(newLines)
    }

    setInput('')
  }

  return (
    <div className="flex flex-col h-full font-mono text-sm">
      <div className="flex-1 overflow-auto p-3">
        {lines.map((line, i) => (
          <div key={i} className={line.type === 'input' ? 'text-neutral-300' : 'text-neutral-500'}>
            {line.text}
          </div>
        ))}
        <form onSubmit={handleSubmit} className="flex items-center">
          <span className="text-green-400 mr-1 shrink-0">~ $</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-transparent outline-none text-neutral-200"
            autoFocus
          />
        </form>
      </div>
    </div>
  )
}