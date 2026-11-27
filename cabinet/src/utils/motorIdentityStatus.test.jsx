import { describe, expect, it } from 'vitest'
import { motorDispatchStatus } from './motorDispatchStatus.js'

describe('UUID workflow completion reporting', () => {
  it('reports a reused completed action as skipped without claiming a new transmission', () => {
    const message = motorDispatchStatus({ workflow_action: 'finish_open', outcome: 'completed',
      dispatch_skipped: true, serial_command_sent: false, serial_command_completed: false,
      physical_movement_verified: false, error: 'Motor dispatch skipped: existing COMPLETED action retained.' }, 'finish_open')
    expect(message).toContain('Motor dispatch skipped')
    expect(message).toContain('no command was transmitted for this request')
    expect(message).toContain('Physical movement was not verified')
    expect(message).not.toContain('ESP32 completed its command sequence')
  })
  it('reports missing identities and legacy sessions within the existing status text', () => {
    for (const error of ['Motor dispatch skipped: missing or invalid session UUID.',
      'Motor dispatch skipped: legacy session requires explicit reconciliation.']) {
      const message = motorDispatchStatus({ workflow_action: 'finish_open', outcome: 'rejected',
        dispatch_skipped: true, serial_command_sent: false, error }, 'finish_open')
      expect(message).toContain('Motor dispatch skipped')
      expect(message).toContain(error)
    }
  })
  it('still separates a completed command from physically verified movement', () => {
    expect(motorDispatchStatus({ workflow_action: 'finish_close', outcome: 'completed',
      dispatch_skipped: false, serial_command_sent: true, physical_movement_verified: false }, 'finish_close'))
      .toContain('physical shutter movement was not verified')
  })
  it('does not claim no transmission when skipped metadata is inconsistent', () => {
    const message = motorDispatchStatus({ workflow_action: 'finish_open', outcome: 'completed',
      dispatch_skipped: true, serial_command_sent: true }, 'finish_open')
    expect(message).toContain('transmission status is unconfirmed')
    expect(message).not.toContain('no command was transmitted')
  })

  it('reports the Phase 1 CLOSE block without claiming physical closure', () => {
    const message = motorDispatchStatus({ workflow_action: 'finish_close', outcome: 'rejected',
      serial_command_sent: false, error: 'CLOSE unavailable: BENCH_OPEN_ONLY.' }, 'finish_close')
    expect(message).toContain('CLOSE unavailable in bench-test mode')
    expect(message).toContain('No movement command was sent')
  })

  it('reports limit rejections and motion aborts without treating the input as verified travel', () => {
    for (const [reason, recovery] of [['TARGET_LIMIT_ACTIVE', false], ['LIMIT_INPUT_OPEN', true]]) {
      const message = motorDispatchStatus({ workflow_action: 'finish_open',
        serial_command_sent: recovery, error: reason, safety_recovery_required: recovery }, 'finish_open')
      expect(message).toContain('OPEN limit active or disconnected')
      expect(message).toContain('Physical position is unverified')
      expect(message.includes('Operator recovery is required')).toBe(recovery)
    }
  })

  it('reports current safety faults without treating historical responses as a fresh command', () => {
    const dispatch = { workflow_action: 'finish_open', outcome: 'uncertain', stop_latched: true,
      serial_command_sent: true, error: 'STOP_LATCHED' }
    expect(motorDispatchStatus(dispatch, 'finish_open')).toContain('stop latched. Operator recovery is required')
    expect(motorDispatchStatus({ ...dispatch, dispatch_skipped: true, serial_command_sent: false }, 'finish_open'))
      .toContain('no command was transmitted for this request')
  })

  it('distinguishes a serial interruption and manual recovery from automatic movement', () => {
    const message = motorDispatchStatus({ workflow_action: 'finish_open', outcome: 'uncertain',
      serial_command_sent: false, communication_ready: false, safety_recovery_required: true }, 'finish_open')
    expect(message).toContain('Serial communication is unavailable')
    expect(message).toContain('Operator recovery is required')
    const interrupted = motorDispatchStatus({ workflow_action: 'finish_open', outcome: 'uncertain',
      serial_command_sent: true, serial_accepted: true, safety_recovery_required: true }, 'finish_open')
    expect(interrupted).toContain('completion is unconfirmed')
    expect(interrupted).toContain('Operator recovery is required')
  })
})
