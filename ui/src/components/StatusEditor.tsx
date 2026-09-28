import { useState } from 'react'
import { toast } from 'sonner'
import { patchApplication } from '@/lib/api'
import { STATUSES } from '@/lib/rows'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Status goes through set-status.mjs (validated, locked, logged to
// status-log.tsv). The note box sends ONLY the new text — set-status appends
// it; re-sending the existing note would duplicate it.
export function StatusEditor({ num, status, onSaved }: { num: string; status: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function save(body: { status?: string; note?: string }, done: string) {
    setBusy(true)
    try {
      await patchApplication(num, body)
      toast.success(done)
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Status</span>
        <Select value={status} disabled={busy} onValueChange={s => s !== status && save({ status: s }, `Status → ${s}`)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Textarea placeholder="Add a note (appended to the existing notes)" value={note} disabled={busy}
          onChange={e => setNote(e.target.value)} />
        <Button size="sm" disabled={busy || !note.trim()}
          onClick={() => save({ note: note.trim() }, 'Note added').then(() => setNote(''))}>Add note</Button>
      </div>
    </div>
  )
}
