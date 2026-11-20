import { describe, expect, it } from 'vitest'
import { pluralize } from './labels.js'

describe('pluralize', () => {
  it.each([
    [0, 'Activity', 'Activities', '0 Activities'],
    [1, 'Activity', 'Activities', '1 Activity'],
    [2, 'Activity', 'Activities', '2 Activities'],
    [0, 'Student', 'Students', '0 Students'],
    [1, 'Student', 'Students', '1 Student'],
    [2, 'Student', 'Students', '2 Students'],
    [0, 'Instructor', 'Instructors', '0 Instructors'],
    [1, 'Instructor', 'Instructors', '1 Instructor'],
    [2, 'Instructor', 'Instructors', '2 Instructors'],
    [0, 'Submission', 'Submissions', '0 Submissions'],
    [1, 'Submission', 'Submissions', '1 Submission'],
    [2, 'Submission', 'Submissions', '2 Submissions'],
    [0, 'Section', 'Sections', '0 Sections'],
    [1, 'Section', 'Sections', '1 Section'],
    [2, 'Section', 'Sections', '2 Sections'],
    [0, 'Result', 'Results', '0 Results'],
    [1, 'Result', 'Results', '1 Result'],
    [2, 'Result', 'Results', '2 Results'],
  ])('formats %s %s correctly', (count, singular, plural, expected) => {
    expect(pluralize(count, singular, plural)).toBe(expected)
  })
})