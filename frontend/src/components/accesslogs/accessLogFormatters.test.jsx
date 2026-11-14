import { describe, expect, it } from 'vitest'
import { formatAccessLogDate, formatAccessLogDuration, formatAccessLogTime } from './accessLogFormatters.js'

describe('access-log timestamps', () => {
  it('formats timestamps in Asia/Manila across the UTC date boundary', () => {
    expect(formatAccessLogDate('2026-11-13T16:30:00Z')).toBe('Nov 14, 2026')
    expect(formatAccessLogTime('2026-11-13T16:30:00Z')).toBe('12:30 AM')
  })
})

describe('formatAccessLogDuration', () => {
  it.each([
    [32, '32 sec'],
    [900, '15 min'],
    [4800, '1 hr 20 min'],
    [613380, '7 days 2 hr 23 min'],
    [null, '—'],
    [-1, '—'],
    ['invalid', '—'],
  ])('formats %s seconds as %s', (value, expected) => {
    expect(formatAccessLogDuration(value)).toBe(expected)
  })
})