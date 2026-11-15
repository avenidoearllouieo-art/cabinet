import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ModalBody, ModalFooter, ModalHeader, ModalStepper } from './ModalPrimitives.jsx'
import ConfirmationDialog from './ConfirmationDialog.jsx'

describe('shared modal primitives', () => {
  afterEach(cleanup)

  it('renders the branded header, scrollable content slots, and current step', () => {
    render(
      <div>
        <ModalHeader title="Import Users" description="Validated spreadsheets" icon={<span>Icon</span>} onClose={() => {}} />
        <ModalStepper steps={['Choose Type', 'Upload File']} currentStep={1} ariaLabel="Import steps" />
        <ModalBody>Form content</ModalBody>
        <ModalFooter><button type="button">Continue</button></ModalFooter>
      </div>,
    )

    expect(screen.getByRole('heading', { name: 'Import Users' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Import steps' })).toBeTruthy()
    expect(screen.getByText('Form content')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('provides explicit cancel and confirm behavior for alert dialogs', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmationDialog
        isOpen
        title="Delete section"
        description="This action cannot be undone."
        message="Delete Section A?"
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByRole('alertdialog', { name: 'Delete section' })).toBeTruthy()
    expect(screen.getByText('Delete Section A?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})