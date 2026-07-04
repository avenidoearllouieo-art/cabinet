import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import { Search, BookOpen } from 'lucide-react'

const statusStyles = {
  active: 'bg-[#ECFDF5] text-[#16A34A]',
  inactive: 'bg-[#F3F4F6] text-[#6B7280]',
}

const getStatusBadge = (status) => {
  if (!status) return <span className="text-[#6B7280]">—</span>
  const value = String(status).toLowerCase()
  const style = statusStyles[value] || 'bg-[#F3F4F6] text-[#6B7280]'
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${style}`}>
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  )
}

export default function InstructorSections() {
  const navigate = useNavigate()
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [yearLevelFilter, setYearLevelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    fetchSections()
  }, [])

  const fetchSections = async () => {
    try {
      setLoading(true)
      const response = await api.get('/sections/')
      const rawSections = Array.isArray(response.data) ? response.data : response.data.results || []
      setSections(rawSections)
      setError('')
    } catch (err) {
      console.error('Error fetching instructor sections:', err)
      setError('Failed to load sections.')
    } finally {
      setLoading(false)
    }
  }

  const filteredSections = useMemo(() => {
    let result = sections

    if (query.trim()) {
      const keyword = query.trim().toLowerCase()
      result = result.filter((section) =>
        [section.section_name, section.academic_year]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    if (yearLevelFilter !== 'all') {
      result = result.filter((section) => String(section.year_level || '').toLowerCase() === yearLevelFilter.toLowerCase())
    }

    if (statusFilter !== 'all') {
      result = result.filter((section) => String(section.status || '').toLowerCase() === statusFilter)
    }

    return result
  }, [sections, query, yearLevelFilter, statusFilter])

  const availableYears = useMemo(
    () => [...new Set(sections.map((section) => section.year_level).filter(Boolean))].sort(),
    [sections],
  )

  const totalSections = sections.length
  const totalStudents = sections.reduce((sum, section) => sum + (parseInt(section.student_count) || 0), 0)
  const activeSections = sections.filter((section) => String(section.status || '').toLowerCase() === 'active').length

  const columns = [
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[180px] text-right',
      render: (_value, row) => (
        <button
          onClick={() => navigate(`/instructor/sections/${row.section_id}/students`)}
          className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          View Students
        </button>
      ),
    },
    { key: 'section_name', label: 'Section Name', className: 'min-w-[220px]' },
    { key: 'year_level', label: 'Year Level', className: 'min-w-[130px]' },
    { key: 'student_count', label: 'Number of Students', className: 'min-w-[120px]' },
    { key: 'academic_year', label: 'Academic Year', className: 'min-w-[150px]' },
    {
      key: 'status',
      label: 'Status',
      className: 'min-w-[120px]',
      render: (value) => getStatusBadge(value),
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sections"
        description="View the sections assigned to you and manage student access for each class."
      />

      <div className="grid gap-6 md:grid-cols-3">
        <StatCard icon={<BookOpen size={18} />} label="Total Sections" value={totalSections} subtitle="Assigned to you" />
        <StatCard icon={<BookOpen size={18} />} label="Total Students" value={totalStudents} subtitle="Across all sections" />
        <StatCard icon={<BookOpen size={18} />} label="Active Sections" value={activeSections} subtitle="Ready for teaching" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-6 grid gap-4 lg:grid-cols-4">
          <label className="relative block">
            <span className="sr-only">Search sections</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search section name or academic year"
              className="w-full rounded-full border border-[#E5E7EB] bg-[#F8FAFC] py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
            />
          </label>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Year Level</label>
            <select
              value={yearLevelFilter}
              onChange={(event) => setYearLevelFilter(event.target.value)}
              className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
            >
              <option value="all">All</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <DataTable columns={columns} rows={filteredSections} loading={loading} />
      </div>
    </div>
  )
}
