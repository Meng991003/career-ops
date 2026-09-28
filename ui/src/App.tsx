import { useState } from 'react'
import { ApplicationsTable } from '@/components/ApplicationsTable'
import { BoardPage } from '@/components/BoardPage'
import { JobDrawer } from '@/components/JobDrawer'
import { StatsPage } from '@/components/StatsPage'
import { ThemeToggle } from '@/components/ThemeToggle'
import { TodayPage } from '@/components/TodayPage'
import { ROUTES, useRoute } from '@/lib/route'

const TITLES = {
  today: 'What needs you today',
  applications: 'Where every application stands',
  board: 'Live applications',
  stats: 'How the search is going',
} as const

export default function App() {
  const route = useRoute()
  const [openNum, setOpenNum] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const page = { onOpen: setOpenNum, refreshKey }
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-3 sm:px-6">
          <span aria-hidden className="size-2.5 rounded-full bg-line ring-4 ring-line/15" />
          <span className="mr-3 text-sm font-extrabold tracking-tight">Career-Ops</span>
          <nav aria-label="Screens" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
            {ROUTES.map(r => (
              <a key={r.id} href={`#/${r.id}`} aria-current={route === r.id ? 'page' : undefined}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${route === r.id ? 'bg-accent font-semibold text-line' : 'text-muted-foreground hover:text-foreground'}`}>
                {r.label}
              </a>
            ))}
          </nav>
          <a href="/legacy" className="ml-auto mr-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Setup (old UI)</a>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="mb-5 text-3xl font-extrabold tracking-tight sm:text-4xl">{TITLES[route]}</h1>
        {route === 'today' && <TodayPage {...page} />}
        {route === 'applications' && <ApplicationsTable {...page} />}
        {route === 'board' && <BoardPage {...page} />}
        {route === 'stats' && <StatsPage />}
        <JobDrawer num={openNum} onClose={() => setOpenNum(null)} onChanged={() => setRefreshKey(k => k + 1)} />
      </main>
    </div>
  )
}
