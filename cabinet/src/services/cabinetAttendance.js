export function isSessionMember(session, participant) {
  if (!session || !participant) return false

  const sessionParticipants = session.participants || []
  const sessionStudentIds = new Set([
    ...(session.participantIds || []),
    ...sessionParticipants.map((member) => member.studentId),
  ])
  const sessionUids = new Set([
    ...(session.participantUids || []),
    ...sessionParticipants.map((member) => member.uid),
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