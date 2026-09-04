import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import { ChevronLeft, ClipboardList, AlertCircle } from 'lucide-react'

export default function InstructorStudentProfile() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submissionsCount, setSubmissionsCount] = useState(0)
  const [activitiesCount, setActivitiesCount] = useState(0)

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true)
      const [studentResponse, submissionsResponse, activitiesResponse] = await Promise.all([
        api.get(`/users/${studentId}/`),
        api.get(`/submissions/?student=${studentId}`),
        api.get('/activities/'),
      ])

      setStudent(studentResponse.data)
      setSubmissionsCount(Array.isArray(submissionsResponse.data) ? submissionsResponse.data.length : (submissionsResponse.data.results || []).length)
      setActivitiesCount(Array.isArray(activitiesResponse.data) ? activitiesResponse.data.length : (activitiesResponse.data.results || []).length)
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
    <div className="space-y-8">
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

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
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
              <h3 className="text-sm font-semibold text-slate-700">RFID Number</h3>
              <p className="mt-2 text-slate-900">{student?.nfc_uid || '—'}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Status</h3>
              <p className="mt-2 text-slate-900">{student?.is_active ? 'Active' : 'Inactive'}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <StatCard icon={<ClipboardList size={18} />} label="Submitted Activities" value={submissionsCount} subtitle="Activities received" />
          <StatCard icon={<AlertCircle size={18} />} label="Missing Activities" value={missingActivities} subtitle="Pending submissions" />
        </div>
      </div>
    </div>
  )
}
