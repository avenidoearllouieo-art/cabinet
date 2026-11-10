import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'

describe('Sidebar navigation', () => {
  afterEach(cleanup)

  it.each([
    ['admin', 'Users'],
    ['instructor', 'Sections'],
    ['student', 'Activities'],
  ])('keeps %s navigation without a Settings item', (variant, expectedLink) => {
    render(<MemoryRouter><Sidebar variant={variant} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: expectedLink })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  })
})