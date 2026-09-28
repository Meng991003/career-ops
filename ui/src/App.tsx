import { useEffect, useState } from 'react'

export default function App() {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    fetch('/api/applications').then(r => r.json()).then(d => setCount(d.rows.length))
  }, [])
  return <main className="p-6 text-sm">career-ops UI — {count ?? '…'} tracker rows</main>
}
