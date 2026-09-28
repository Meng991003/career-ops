import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

const NEXT = { system: 'light', light: 'dark', dark: 'system' } as const
const LABEL = { system: 'Match system', light: 'Light', dark: 'Dark' } as const
const ICON = { system: Monitor, light: Sun, dark: Moon } as const

// One button that cycles System → Light → Dark; the label names the current mode.
export function ThemeToggle() {
  const { theme = 'system', setTheme } = useTheme()
  const t = (theme in NEXT ? theme : 'system') as keyof typeof NEXT
  const Icon = ICON[t]
  return (
    <button type="button" onClick={() => setTheme(NEXT[t])}
      aria-label={`Theme: ${LABEL[t]}. Switch to ${LABEL[NEXT[t]]}`}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-xs text-muted-foreground transition-colors hover:text-foreground">
      <Icon className="size-3.5" aria-hidden />
      {LABEL[t]}
    </button>
  )
}
