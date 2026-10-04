export function isSessionMember(session, participant) {
  if (!session || !participant) return false

  const openedBy = session.opened_by || []
  const sessionStudentIds = new Set([
    ...(session.openedByStudentIds || []),
    ...openedBy.map((member) => member.studentId),
  ])
  const sessionUids = new Set([
    ...(session.openedByUids || []),
    ...openedBy.map((member) => member.uid),
  ])

  return Boolean(
    (participant.studentId && sessionStudentIds.has(participant.studentId))
    || (participant.uid && sessionUids.has(participant.uid))
  )
}

export function recordClosingAttendance(session, attendance, participant) {
  if (!isSessionMember(session, participant)) {
    return { status: 'rejected', attendance }
  }

  const existingParticipant = attendance.find((member) => (
    (participant.uid && member.uid === participant.uid)
    || (participant.studentId && member.studentId === participant.studentId)
  ))
  if (existingParticipant) {
    return { status: 'duplicate', attendance, participant: existingParticipant }
  }

  return { status: 'added', attendance: [...attendance, participant], participant }
}