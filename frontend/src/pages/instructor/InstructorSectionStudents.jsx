import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import DataTable from '../../components/DataTable'
import { Search, ChevronLeft } from 'lucide-react'

export default function InstructorSectionStudents() {
  const { sectionId } = useParams()
  const navigate = useNavigate()
  const [section, setSection] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sortField, setSortField] = useState('name')
  const [sortDirection, setSortDirection] = useState('asc')

  const fetchSectionStudents = useCallback(async () => {
    try {
      setLoading(true)
      const [sectionResponse, studentResponse] = await Promise.all([
        api.get(`/sections/${sectionId}/`),
        api.get(`/users/?section=${sectionId}&role=student`),
      ])
      setSection(sectionResponse.data)
      setStudents(Array.isArray(studentResponse.data) ? studentResponse.data : studentResponse.data.results || [])
      setError('')
    } catch (err) {
      console.error('Error fetching section students:', err)
      setError('Failed to load students for this section.')
    } finally {
      setLoading(false)
    }
  }, [sectionId])

  useEffect(() => {
    const loadStudents = async () => {
      await fetchSectionStudents()
    }
    loadStudents()
  }, [sectionId, fetchSectionStudents])

  const filteredStudents = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    let result = students

    if (keyword) {
      result = result.filter((student) =>
        [
          student.student_id,
          `${student.first_name} ${student.last_name}`,
          student.email,
          student.nfc_uid,
          student.section_name,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    return [...result].sort((a, b) => {
      if (sortField === 'student_id') {
        const left = String(a.student_id || '').toLowerCase()
        const right = String(b.student_id || '').toLowerCase()
        return sortDirection === 'asc' ? left.localeCompare(right) : right.localeCompare(left)
      }

      const left = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase()
      const right = `${b.first_name || ''} ${b.last_name || ''}`.trim().toLowerCase()
      return sortDirection === 'asc' ? left.localeCompare(right) : right.localeCompare(left)
    })
  }, [students, query, sortField, sortDirection])

  const columns = [
    {
      key: 'profile_image_url',
      label: 'Photo',
      className: 'min-w-[100px]',
      render: (_value, row) => (
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 overflow-hidden rounded-full bg-slate-100">
            {row.profile_image_url ? (
              <img src={row.profile_image_url} alt={`${row.first_name || ''} ${row.last_name || ''}`} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-sm text-slate-500">N/A</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'full_name',
      label: 'Student Name',
      className: 'min-w-[220px]',
      render: (_value, row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() || '—',
    },
    { key: 'student_id', label: 'Student ID', className: 'min-w-[160px]' },
    {
      key: 'nfc_uid',
      label: 'NFC UID',
      className: 'min-w-[160px]',
      render: (value) => value || '—',
    },
    { key: 'email', label: 'Email', className: 'min-w-[220px]' },
    {
      key: 'section_name',
      label: 'Section',
      className: 'min-w-[180px]',
      render: (value) => value || '—',
    },
    {
      key: 'is_active',
      label: 'Registration Status',
      className: 'min-w-[160px]',
      render: (value) => (value ? 'Active' : 'Inactive'),
    },
    {
      key: 'last_access_status',
      label: 'Cabinet Access Status',
      className: 'min-w-[180px]',
      render: (value) => {
        if (!value) return 'No access records'
        return value === 'success' ? 'Last access successful' : 'Last access failed'
      },
    },
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <PageHeader
            title={section ? `${section.section_name} Students` : 'Section Students'}
            description="View the students enrolled in this section."
          />
          {section && (
            <p className="text-sm text-slate-500">
              Year {section.year_level || '—'} • Academic Year {section.academic_year || '—'}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate('/instructor/sections')}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <ChevronLeft size={16} />
          Back to Sections
        </button>
      </div>

      {error && (
        <div className="rounded-[12px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-lg">
            <span className="sr-only">Search students</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search student ID, name, or email"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-11 text-sm text-slate-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setSortField('name')
                setSortDirection((prev) => (sortField === 'name' && prev === 'asc' ? 'desc' : 'asc'))
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${sortField === 'name' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              Sort by Name {sortField === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </button>
            <button
              type="button"
              onClick={() => {
                setSortField('student_id')
                setSortDirection((prev) => (sortField === 'student_id' && prev === 'asc' ? 'desc' : 'asc'))
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${sortField === 'student_id' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              Sort by Student ID {sortField === 'student_id' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </button>
          </div>
        </div>

        <DataTable columns={columns} rows={filteredStudents} loading={loading} />
      </div>
    </div>
  )
}
