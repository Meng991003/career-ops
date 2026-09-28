import { expect, it } from 'vitest'
import { splitReport } from './report'

it('splits a report into its ## sections, keeping the preamble', () => {
  const md = '# Acme — Dev\n**Score:** 4.2/5\n\n## A) Role Summary\nfoo\n\n## Machine Summary\n```yaml\nx: 1\n```\n'
  const s = splitReport(md)
  expect(s.map(x => x.title)).toEqual(['Overview', 'A) Role Summary', 'Machine Summary'])
  expect(s[0].body).toContain('**Score:** 4.2/5')
  expect(s[2].body).toContain('x: 1')
})

it('ignores ## inside fenced code blocks', () => {
  const s = splitReport('intro\n```\n## not a heading\n```\n## Real\nbody')
  expect(s.map(x => x.title)).toEqual(['Overview', 'Real'])
})
