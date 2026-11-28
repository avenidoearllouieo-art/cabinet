import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '../../services/api.js'
import PasswordRecoveryHistory from './PasswordRecoveryHistory.jsx'

vi.mock('../../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('PasswordRecoveryHistory', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{
          id: 8,
          timestamp: '2026-11-22T10:00:00Z',
          student_name: 'Student A',
          account_reference: '•••-001',
          event_type: 'nfc_verified',
          outcome: 'success',
          request_status: 'verified',
          actor_type: 'pi',
          reason_code: 'registered_card_verified',
        }],
      },
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
    expect(screen.getByText('Nfc Verified')).toBeTruthy()
    expect(screen.getByText('Registered Card Verified')).toBeTruthy()
    expect(document.body.textContent).not.toContain('request_id')
    expect(document.body.textContent).not.toContain('nfc_uid')
    expect(api.get).toHaveBeenCalledWith('/admin/password-recovery-history/', { params: { page: 1, page_size: 25 } })
  })
})