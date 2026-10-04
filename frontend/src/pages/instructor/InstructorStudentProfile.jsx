import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import UserCabinetAccessModal from '../../components/users/UserCabinetAccessModal.jsx'
import { ChevronLeft, ClipboardList, AlertCircle } from 'lucide-react'

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return String(value)
  }
}

export default function InstructorStudentProfile() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submissionsCount, setSubmissionsCount] = useState(0)
  const [activitiesCount, setActivitiesCount] = useState(0)
  const [recentAccessLogs, setRecentAccessLogs] = useState([])
  const [accessHistoryOpen, setAccessHistoryOpen] = useState(false)

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true)
      const [studentResponse, submissionsResponse, activitiesResponse, accessLogsResponse] = await Promise.all([
        api.get(`/users/${studentId}/`),
        api.get(`/submissions/?student=${studentId}`),
        api.get('/activities/'),
        api.get(`/users/${studentId}/access-logs/`, { params: { page_size: 5 } }),
      ])

      setStudent(studentResponse.data)
      setSubmissionsCount(Array.isArray(submissionsResponse.data) ? submissionsResponse.data.length : (submissionsResponse.data.results || []).length)
      setActivitiesCount(Array.isArray(activitiesResponse.data) ? activitiesResponse.data.length : (activitiesResponse.data.results || []).length)
      setRecentAccessLogs(Array.isArray(accessLogsResponse.data) ? accessLogsResponse.data : (accessLogsResponse.data.results || []))
      setError('')
    } catch (err) {
      console.error('Error fetching student profile:', err)
      setError('Unable to load student profile.')
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => {
    if (!studentId) return
    const timeoutId = window.setTimeout(fetchProfile, 0)
    return () => window.clearTimeout(timeoutId)
  }, [studentId, fetchProfile])

  const missingActivities = Math.max(0, activitiesCount - submissionsCount)
  const fullName = student ? `${student.first_name || ''} ${student.last_name || ''}`.trim() : ''

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <PageHeader
            title={student ? `${fullName} Profile` : 'Student Profile'}
            description="Review student details and activity progress for this section."
          />
          {student && (
            <p className="text-sm text-slate-500">Student ID: {student.student_id || '—'}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <ChevronLeft size={16} />
          Back
        </button>
      </div>

      {error && (
        <div className="rounded-[12px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Full Name</h3>
              <p className="mt-2 text-slate-900">{fullName || '—'}</p>
            </div>
              <div>
              <h3 className="text-sm font-semibold text-slate-700">Section</h3>
              <p className="mt-2 text-slate-900">{student?.section_name || student?.section?.section_name || '—'}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Year Level</h3>
              <p className="mt-2 text-slate-900">{student?.section_year_level || '—'}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Academic Year</h3>
              <p className="mt-2 text-slate-900">{student?.section_academic_year || '—'}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">NFC UID</h3>
              <p className="mt-2 text-slate-900">{student?.nfc_uid || '—'}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Status</h3>
              <p className="mt-2 text-slate-900">{student?.is_active ? 'Active' : 'Inactive'}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard icon={<ClipboardList />} label="Submitted" value={submissionsCount} subtitle="Activities received" />
          <StatCard icon={<AlertCircle />} label="Missing" value={missingActivities} subtitle="Activities not submitted" bgColor="bg-amber-50" textColor="text-amber-900" />
        </div>
      </div>

      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Recent Cabinet Access</h2>
            <p className="mt-1 text-sm text-slate-500">Latest 5 entries for {fullName || 'this student'}.</p>
          </div>
          <button type="button" onClick={() => setAccessHistoryOpen(true)} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">View</button>
        </div>
        <div className="mt-4 divide-y divide-slate-100">
          {recentAccessLogs.length ? recentAccessLogs.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
              <span className="font-medium text-slate-900">{entry.action || 'Access'} · {entry.station || 'Station unavailable'}</span>
              <span className="text-slate-500">{formatDate(entry.access_time)} · {entry.status || 'Unknown'}</span>
            </div>
          )) : <p className="py-4 text-sm text-slate-500">No recent cabinet access records.</p>}
        </div>
      </section>
      <UserCabinetAccessModal
        isOpen={accessHistoryOpen}
        userId={student?.id || studentId}
        fullName={fullName || 'Student'}
        onClose={() => setAccessHistoryOpen(false)}
      />
    </div>
  )
}
