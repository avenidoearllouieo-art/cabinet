import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import StatCard from '../../components/StatCard'
import DataTable from '../../components/DataTable'
import AddSectionModal from '../../components/sections/AddSectionModal.jsx'
import EditSectionModal from '../../components/sections/EditSectionModal.jsx'
import DeleteSectionModal from '../../components/sections/DeleteSectionModal.jsx'
import { Search, BookOpen, Edit2, Trash2, Plus } from 'lucide-react'

export default function Sections() {
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [programFilter, setProgramFilter] = useState('all')
  const [yearLevelFilter, setYearLevelFilter] = useState('all')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [editingSectionId, setEditingSectionId] = useState(null)
  const [selectedSection, setSelectedSection] = useState(null)
  const [deletingSection, setDeletingSection] = useState(null)
  const [toastMessage, setToastMessage] = useState('')

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
      console.error('Error fetching sections:', err)
      setError('Failed to load sections.')
    } finally {
      setLoading(false)
    }
  }

  const handleSectionAdded = (newSection) => {
    if (!newSection || !newSection.id) {
      fetchSections()
      return
    }

    setSections((prev) => [newSection, ...prev])
    setToastMessage('Section created successfully.')
    setIsAddModalOpen(false)
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  const handleSectionSaved = (savedSection) => {
    if (!savedSection || !savedSection.id) {
      fetchSections()
      return
    }

    setSections((existingSections) => {
      return existingSections.map((section) => (section.id === savedSection.id ? savedSection : section))
    })

    setToastMessage('Section updated successfully.')
    setIsEditModalOpen(false)
    setEditingSectionId(null)
    setSelectedSection(null)
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  const handleSectionDeleted = async (deletedSectionId) => {
    setSections((existingSections) => existingSections.filter((section) => section.id !== deletedSectionId))
    setToastMessage('Section deleted successfully.')
    setIsDeleteModalOpen(false)
    setDeletingSection(null)
    setSelectedSection(null)
    window.setTimeout(() => setToastMessage(''), 4000)

    try {
      await fetchSections()
    } catch (err) {
      console.error('Failed to refresh sections after delete', err)
    }
  }

  const handleOpenEditModal = (id, row) => {
    if (!id) return
    setEditingSectionId(id)
    setSelectedSection(row || null)
    setIsEditModalOpen(true)
  }

  const handleOpenDeleteModal = (row) => {
    setDeletingSection(row)
    setIsDeleteModalOpen(true)
  }

  const filteredSections = useMemo(() => {
    let result = sections

    // Apply search filter
    if (query.trim()) {
      const keyword = query.trim().toLowerCase()
      result = result.filter((section) =>
        [section.section_code, section.section_name, section.year_level, section.program]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    // Apply program filter
    if (programFilter !== 'all') {
      result = result.filter((section) => {
        const program = String(section.program || '')
        return program === programFilter
      })
    }

    // Apply year level filter
    if (yearLevelFilter !== 'all') {
      result = result.filter((section) => {
        const level = String(section.year_level || '')
        return level === yearLevelFilter
      })
    }

    return result
  }, [sections, query, programFilter, yearLevelFilter])

  const totalSections = sections.length
  const activeSections = sections.filter((section) => String(section.status || '').toLowerCase() === 'active').length
  const totalStudents = sections.reduce((sum, section) => sum + (parseInt(section.student_count) || 0), 0)
  const totalInstructors = new Set(sections.map((s) => s.adviser_instructor).filter(Boolean)).size

  const statusStyles = {
    active: 'bg-[#ECFDF5] text-[#16A34A]',
    inactive: 'bg-[#F3F4F6] text-[#6B7280]',
  }

  const getStatusBadge = (status) => {
    if (!status) return <span className="text-[#6B7280]">—</span>
    const lower = String(status).toLowerCase()
    const style = statusStyles[lower] || 'bg-[#F3F4F6] text-[#6B7280]'
    return (
      <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${style}`}>
        {lower.charAt(0).toUpperCase() + lower.slice(1)}
      </span>
    )
  }

  const columns = [
    {
      key: 'actions',
      label: 'Actions',
      className: 'min-w-[140px]',
      render: (_value, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenEditModal(row.id, row)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-2 py-2 text-xs font-medium text-white hover:bg-blue-700"
            title="Edit section"
          >
            <Edit2 size={14} />
            Edit
          </button>
          <button
            onClick={() => handleOpenDeleteModal(row)}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-2 py-2 text-xs font-medium text-white hover:bg-red-700"
            title="Delete section"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      ),
    },
    {
      key: 'section_code',
      label: 'Section Code',
      className: 'min-w-[120px]',
    },
    {
      key: 'section_name',
      label: 'Section Name',
      className: 'min-w-[120px]',
    },
    {
      key: 'program',
      label: 'Program',
      className: 'min-w-[100px]',
    },
    {
      key: 'year_level',
      label: 'Year Level',
      className: 'min-w-[120px]',
    },
    {
      key: 'adviser_instructor',
      label: 'Adviser / Instructor',
      className: 'min-w-[150px]',
      render: (value) => value || '—',
    },
    {
      key: 'student_count',
      label: 'Student Count',
      className: 'min-w-[120px]',
      render: (value) => value || '0',
    },
    {
      key: 'status',
      label: 'Status',
      className: 'min-w-[110px]',
      render: (value) => getStatusBadge(value),
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sections Management"
        description="Create and manage academic sections used throughout the system."
        action={
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 rounded-[10px] bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1D4ED8]"
          >
            <Plus size={16} />
            Add Section
          </button>
        }
      />

      <div className="grid gap-6 md:grid-cols-4">
        <StatCard icon={<BookOpen size={18} />} label="Total Sections" value={totalSections} subtitle="All sections" />
        <StatCard icon={<BookOpen size={18} />} label="Active Sections" value={activeSections} subtitle="Active sections" />
        <StatCard icon={<BookOpen size={18} />} label="Total Students" value={totalStudents} subtitle="Enrolled students" />
        <StatCard icon={<BookOpen size={18} />} label="Total Instructors" value={totalInstructors} subtitle="Unique advisers" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Section Records</h2>
            <p className="text-sm text-[#6B7280]">Browse and manage all academic sections.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="relative block">
              <span className="sr-only">Search sections</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search code, name, year, program"
                className="w-full rounded-full border border-[#E5E7EB] bg-[#F9FAFB] py-3 pl-11 pr-4 text-sm text-[#111827] shadow-sm outline-none transition focus:border-[#2563EB] focus:bg-white"
              />
            </label>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Filter Program</label>
              <select
                value={programFilter}
                onChange={(e) => setProgramFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All Programs</option>
                <option value="BSIT">BSIT</option>
                <option value="BSCS">BSCS</option>
                <option value="BSIS">BSIS</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Filter Year Level</label>
              <select
                value={yearLevelFilter}
                onChange={(e) => setYearLevelFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="1st Year">1st Year</option>
                <option value="2nd Year">2nd Year</option>
                <option value="3rd Year">3rd Year</option>
                <option value="4th Year">4th Year</option>
              </select>
            </div>
          </div>
        </div>

        <DataTable columns={columns} data={filteredSections} loading={loading} showActions={false} />
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      <AddSectionModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onUnauthorized={() => setIsAddModalOpen(false)}
        onSaved={handleSectionAdded}
      />

      <EditSectionModal
        isOpen={isEditModalOpen}
        sectionId={editingSectionId}
        section={selectedSection}
        onClose={() => {
          setIsEditModalOpen(false)
          setEditingSectionId(null)
          setSelectedSection(null)
        }}
        onUnauthorized={() => {
          setIsEditModalOpen(false)
          setEditingSectionId(null)
          setSelectedSection(null)
        }}
        onSaved={handleSectionSaved}
      />

      <DeleteSectionModal
        isOpen={isDeleteModalOpen}
        section={deletingSection}
        onClose={() => {
          setIsDeleteModalOpen(false)
          setDeletingSection(null)
        }}
        onUnauthorized={() => {
          setIsDeleteModalOpen(false)
          setDeletingSection(null)
        }}
        onDeleted={handleSectionDeleted}
      />
    </div>
  )
}
