import { expect, it } from 'vitest'
import { parseRoute } from './route'

it('maps hashes to routes and defaults to today', () => {
  expect(parseRoute('#/board')).toBe('board')
  expect(parseRoute('#/stats')).toBe('stats')
  expect(parseRoute('#/applications')).toBe('applications')
  expect(parseRoute('')).toBe('today')
  expect(parseRoute('#/nope')).toBe('today')
})
