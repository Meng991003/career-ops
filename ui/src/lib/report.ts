// Evaluation reports are Blocks A–G + Machine Summary as `## ` sections; the
// drawer shows each as a collapsible <details>.
export function splitReport(md: string): { title: string; body: string }[] {
  const out = [{ title: 'Overview', body: '' }]
  let fenced = false
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced
    const h = !fenced && /^## (.+)$/.exec(line)
    if (h) out.push({ title: h[1].trim(), body: '' })
    else out[out.length - 1].body += line + '\n'
  }
  return out.filter((s, i) => i > 0 || s.body.trim())
}
