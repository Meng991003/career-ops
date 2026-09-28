import { useState } from 'react'
import { ApplicationsTable } from '@/components/ApplicationsTable'
import { JobDrawer } from '@/components/JobDrawer'

export default function App() {
  const [openNum, setOpenNum] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-4 py-3 sm:px-6">
          <span aria-hidden className="size-2.5 rounded-full bg-line ring-4 ring-line/15" />
          <span className="text-sm font-extrabold tracking-tight">Career-Ops</span>
          <span className="text-sm text-muted-foreground">/ Applications</span>
          <a href="/legacy" className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Setup (old UI)</a>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="mb-5 text-3xl font-extrabold tracking-tight sm:text-4xl">Where every application stands</h1>
        <ApplicationsTable onOpen={setOpenNum} refreshKey={refreshKey} />
        <JobDrawer num={openNum} onClose={() => setOpenNum(null)} onChanged={() => setRefreshKey(k => k + 1)} />
      </main>
    </div>
  )
}
