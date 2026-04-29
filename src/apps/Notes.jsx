import { useState } from 'react'

export default function Notes() {
  const [text, setText] = useState('Write notes here...')

  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      className="w-full h-full bg-transparent resize-none outline-none text-neutral-200 text-sm p-3"
    />
  )
}