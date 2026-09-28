import { useState } from 'react'
import { ApplicationsTable } from '@/components/ApplicationsTable'
import { JobDrawer } from '@/components/JobDrawer'

export default function App() {
  const [openNum, setOpenNum] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-semibold">Applications</h1>
      <ApplicationsTable onOpen={setOpenNum} refreshKey={refreshKey} />
      <JobDrawer num={openNum} onClose={() => setOpenNum(null)} onChanged={() => setRefreshKey(k => k + 1)} />
    </main>
  )
}
