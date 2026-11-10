import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import api from '../services/api.js'
import CabinetStationStatus from './CabinetStationStatus.jsx'

vi.mock('../services/api.js', () => ({ default: { get: vi.fn() } }))

describe('CabinetStationStatus', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('does not present an unknown station as available or a participant count as a user', async () => {
    api.get.mockResolvedValue({ data: { stations: [
      { station: 'Station 1', status: 'OCCUPIED', active_session: { participant_count: 0, opened_at: '2026-10-10T10:00:00Z' } },
      { station: 'Station 2', status: 'UNKNOWN', active_session: null },
    ] } })
    render(<CabinetStationStatus detailLevel="instructor" />)

    expect(await screen.findByText('Unknown user')).toBeTruthy()
    expect(screen.getByText('UNKNOWN')).toBeTruthy()
    expect(screen.queryByText('AVAILABLE')).toBeNull()
    expect(screen.queryByText('Opened by 0')).toBeNull()
  })

  it('shows Offline when a refresh cannot confirm station status', async () => {
    api.get.mockRejectedValue(new Error('offline'))
    render(<CabinetStationStatus detailLevel="instructor" />)

    expect(await screen.findByText('Station status is currently unavailable.')).toBeTruthy()
    expect(screen.getByText(/Offline/)).toBeTruthy()
  })
})