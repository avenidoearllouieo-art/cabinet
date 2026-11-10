import { describe, expect, it } from 'vitest'
import { formatAccessLogDuration } from './accessLogFormatters.js'

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