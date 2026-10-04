import assert from 'node:assert/strict'
import test from 'node:test'
import { isSessionMember, recordClosingAttendance } from './cabinetAttendance.js'

const members = Array.from({ length: 5 }, (_, index) => ({
  uid: `uid-${index + 1}`,
  fullName: `Member ${index + 1}`,
  studentId: `STUDENT-${index + 1}`,
}))

const stationOne = {
  id: 'session-1',
  station: 1,
  status: 'open',
  opened_by: members,
  openedByStudentIds: members.map((member) => member.studentId),
  openedByUids: members.map((member) => member.uid),
}

const stationTwoMember = { uid: 'uid-station-2', fullName: 'Station 2 Member', studentId: 'STATION-2' }
const stationTwo = {
  id: 'session-2',
  station: 2,
  status: 'open',
  opened_by: [stationTwoMember],
  openedByStudentIds: [stationTwoMember.studentId],
  openedByUids: [stationTwoMember.uid],
}

function collectMembers(session, participants) {
  return participants.reduce((attendance, participant) => {
    const result = recordClosingAttendance(session, attendance, participant)
    assert.equal(result.status, 'added')
    return result.attendance
  }, [])
}

test('one of five opening members can close the session', () => {
  const attendance = collectMembers(stationOne, members.slice(0, 1))
  assert.equal(attendance.length, 1)
})

test('multiple closing members are recorded without requiring full attendance', () => {
  const attendance = collectMembers(stationOne, members.slice(0, 2))
  assert.deepEqual(attendance, members.slice(0, 2))
})

test('all five opening members can record closing attendance', () => {
  const attendance = collectMembers(stationOne, members)
  assert.deepEqual(attendance, members)
})

test('duplicate UID or student ID does not increase closing attendance', () => {
  const first = recordClosingAttendance(stationOne, [], members[0])
  assert.equal(first.status, 'added')

  const duplicateUid = recordClosingAttendance(stationOne, first.attendance, { ...members[0], studentId: 'OTHER-ID' })
  assert.equal(duplicateUid.status, 'duplicate')
  assert.equal(duplicateUid.attendance.length, 1)

  const duplicateStudentId = recordClosingAttendance(stationOne, first.attendance, { ...members[1], uid: 'OTHER-UID', studentId: members[0].studentId })
  assert.equal(duplicateStudentId.status, 'duplicate')
  assert.equal(duplicateStudentId.attendance.length, 1)
})

test('a member from another active station is rejected', () => {
  assert.equal(isSessionMember(stationOne, stationTwoMember), false)
  const result = recordClosingAttendance(stationOne, [], stationTwoMember)
  assert.equal(result.status, 'rejected')
  assert.equal(result.attendance.length, 0)
  assert.equal(isSessionMember(stationTwo, stationTwoMember), true)
})

test('an unknown or unregistered card is rejected without adding attendance', () => {
  const unknown = { uid: 'uid-unknown', fullName: 'Unknown Card', studentId: 'UNKNOWN' }
  const result = recordClosingAttendance(stationOne, [], unknown)
  assert.equal(result.status, 'rejected')
  assert.equal(result.attendance.length, 0)
})