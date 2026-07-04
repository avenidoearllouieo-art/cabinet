import { useEffect, useMemo, useState } from 'react'
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

  useEffect(() => {
    fetchSectionStudents()
  }, [sectionId])

  const fetchSectionStudents = async () => {
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
  }

  const filteredStudents = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    let result = students

    if (keyword) {
      result = result.filter((student) =>
        [student.student_id, `${student.first_name} ${student.last_name}`, student.email]
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
    { key: 'student_id', label: 'Student ID', className: 'min-w-[160px]' },
    {
      key: 'full_name',
      label: 'Full Name',
      className: 'min-w-[220px]',
      render: (_value, row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() || '—',
    },
    { key: 'email', label: 'Email', className: 'min-w-[220px]' },
    {
      key: 'nfc_uid',
      label: 'RFID Number',
      className: 'min-w-[180px]',
      render: (value) => value || '—',
    },
    {
      key: 'is_active',
      label: 'Status',
      className: 'min-w-[120px]',
      render: (value) => (value ? 'Active' : 'Inactive'),
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[160px] text-right',
      render: (_value, row) => (
        <button
          type="button"
          onClick={() => navigate(`/instructor/students/${row.id}`)}
          className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          View Profile
        </button>
      ),
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
              className="w-full rounded-full border border-[#E5E7EB] bg-[#F8FAFC] py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
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
