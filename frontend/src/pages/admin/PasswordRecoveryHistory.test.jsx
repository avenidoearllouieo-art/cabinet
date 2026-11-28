import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import PasswordRecoveryHistory from './PasswordRecoveryHistory.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('PasswordRecoveryHistory', () => {
  beforeEach(() => {
    api.get.mockImplementation((_url, config) => {
      if (config?.params?.view === 'stats') {
        return Promise.resolve({ data: { pending_verification: 2, verified_awaiting_completion: 1, completed_in_range: 4, rejected_attempts_in_range: 3 } })
      }
      return Promise.resolve({
        data: {
          count: 1,
          next: null,
          previous: null,
          results: [{
            id: 8,
            request_id: 'opaque-request-id',
            requested_at: '2026-11-22T10:00:00Z',
            student_name: 'Student A',
            section: 'Section A',
            account_reference: '•••-001',
            status: 'verified',
            nfc_verified: true,
            nfc_verification_attempt_count: 1,
            expires_at: '2026-11-22T10:15:00Z',
            completed_at: null,
            timeline: [],
          }],
        },
      })
    })
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('renders masked recovery history without credentials or raw NFC identifiers', async () => {
    render(<MemoryRouter><PasswordRecoveryHistory /></MemoryRouter>)

    expect(await screen.findByText('Student A')).toBeTruthy()
    expect(screen.getByText('•••-001')).toBeTruthy()
    expect(screen.getByText('Verified – Awaiting Reset')).toBeTruthy()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain('request_id')
    expect(document.body.textContent).not.toContain('nfc_uid')
    expect(api.get).toHaveBeenCalledWith('/admin/password-recovery-history/', { params: { page: 1, page_size: 10, view: 'requests' } })
  })
})