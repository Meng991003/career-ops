import { useState } from 'react'

type Datum = { label: string; value: number }

// Single-series bars. One hue (--mark), no legend (the title names the series),
// per-bar tooltip on hover and keyboard focus, and a table view for exact values.
export function Bars({ title, data, orientation = 'horizontal', format = (n: number) => n.toLocaleString() }: {
  title: string; data: Datum[]; orientation?: 'horizontal' | 'vertical'; format?: (n: number) => string
}) {
  const [hot, setHot] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(d => d.value))
  const tip = (i: number) => `${data[i].label}: ${format(data[i].value)}`

  return (
    <figure className="rounded-xl border bg-card p-4">
      <figcaption className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span aria-live="polite" className="font-mono text-xs text-muted-foreground">{hot !== null ? tip(hot) : ''}</span>
      </figcaption>

      {orientation === 'horizontal' ? (
        <ul className="space-y-0.5">
          {data.map((d, i) => (
            <li key={d.label} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">{d.label}</span>
              <span className="h-3.5 rounded-sm" tabIndex={0} aria-label={tip(i)}
                onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)}>
                <span className={`block h-full rounded-r-[4px] bg-mark transition-opacity ${hot !== null && hot !== i ? 'opacity-40' : ''}`}
                  style={{ width: `${(d.value / max) * 100}%`, minWidth: d.value ? 2 : 0 }} />
              </span>
              <span className="text-right font-mono tabular-nums">{format(d.value)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex h-40 items-end gap-[2px] border-b">
          {data.map((d, i) => (
            <span key={d.label} className="flex h-full flex-1 items-end" tabIndex={0} aria-label={tip(i)}
              onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)}>
              <span className={`block w-full rounded-t-[4px] bg-mark transition-opacity ${hot !== null && hot !== i ? 'opacity-40' : ''}`}
                style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }} />
            </span>
          ))}
        </div>
      )}
      {orientation === 'vertical' && (
        <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground">
          <span>{data[0]?.label}</span><span>{data.at(-1)?.label}</span>
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as table</summary>
        <table className="mt-2 w-full">
          <tbody>
            {data.map(d => (
              <tr key={d.label} className="border-t">
                <td className="py-1 text-muted-foreground">{d.label}</td>
                <td className="py-1 text-right font-mono tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
