import { useState } from 'react'
import { ApplicationsTable } from '@/components/ApplicationsTable'

export default function App() {
  const [openNum, setOpenNum] = useState<string | null>(null)
  const [refreshKey] = useState(0)
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Applications</h1>
      <ApplicationsTable onOpen={setOpenNum} refreshKey={refreshKey} />
      {openNum && <p className="sr-only">selected #{openNum}</p>}
    </main>
  )
}
