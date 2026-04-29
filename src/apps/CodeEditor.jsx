import { useState } from 'react'

const starterCode = `function greet(name) {
  return "Hello, " + name + "!";
}

console.log(greet("World"));`

export default function CodeEditor() {
  const [code, setCode] = useState(starterCode)

  const lineCount = code.split('\n').length

  return (
    <div className="flex h-full font-mono text-sm p-3">
      <div className="flex flex-col items-end pr-3 text-neutral-600 select-none border-r border-neutral-700 shrink-0 overflow-hidden">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="leading-6">{i + 1}</div>
        ))}
      </div>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        className="flex-1 bg-transparent text-green-400 resize-none outline-none pl-3 leading-6"
      />
    </div>
  )
}