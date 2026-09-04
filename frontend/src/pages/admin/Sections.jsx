import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import AddSectionModal from '../../components/sections/AddSectionModal.jsx'
import EditSectionModal from '../../components/sections/EditSectionModal.jsx'
import DeleteSectionModal from '../../components/sections/DeleteSectionModal.jsx'
import { Search, BookOpen, Edit2, Trash2, Plus, MoreHorizontal, Eye, Users, UserCog, Layers3 } from 'lucide-react'

export default function Sections() {
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const programFilter = 'all'
  const yearLevelFilter = 'all'
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [editingSectionId, setEditingSectionId] = useState(null)
  const [selectedSection, setSelectedSection] = useState(null)
  const [deletingSection, setDeletingSection] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [openActionId, setOpenActionId] = useState(null)
  const [selectedSectionForDrawer, setSelectedSectionForDrawer] = useState(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [instructorFilter, setInstructorFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const actionMenuRef = useRef(null)

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

  useEffect(() => {
    const load = async () => {
      await fetchSections()
    }
    load()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
        setOpenActionId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

    if (query.trim()) {
      const keyword = query.trim().toLowerCase()
      result = result.filter((section) =>
        [section.section_code, section.section_name, section.year_level, section.program, section.instructor_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword)),
      )
    }

    if (programFilter !== 'all') {
      result = result.filter((section) => String(section.program || '') === programFilter)
    }

    if (yearLevelFilter !== 'all') {
      result = result.filter((section) => String(section.year_level || '') === yearLevelFilter)
    }

    if (instructorFilter !== 'all') {
      result = result.filter((section) => {
        const instructorName = String(section.instructor_name || '').trim().toLowerCase()
        return instructorFilter === 'unassigned' ? !instructorName : instructorName.includes(instructorFilter.toLowerCase())
      })
    }

    if (statusFilter !== 'all') {
      result = result.filter((section) => String(section.status || '').toLowerCase() === statusFilter.toLowerCase())
    }

    const sorted = [...result]
    sorted.sort((left, right) => {
      if (sortBy === 'students') return (Number(right.student_count || 0) || 0) - (Number(left.student_count || 0) || 0)
      if (sortBy === 'instructors') {
        const leftName = String(left.instructor_name || '').toLowerCase()
        const rightName = String(right.instructor_name || '').toLowerCase()
        return leftName.localeCompare(rightName)
      }
      return String(left.section_name || '').localeCompare(String(right.section_name || ''))
    })

    return sorted
  }, [sections, query, programFilter, yearLevelFilter, instructorFilter, statusFilter, sortBy])

  const totalSections = sections.length
  const totalStudents = sections.reduce((sum, section) => sum + (parseInt(section.student_count) || 0), 0)
  const totalInstructors = new Set(sections.map((section) => section.instructor_name || '').filter(Boolean)).size
  const averageStudentsPerSection = totalSections ? Math.round(totalStudents / totalSections) : 0

  const instructorOptions = useMemo(() => {
    const options = Array.from(new Set(sections.map((section) => String(section.instructor_name || '').trim()).filter(Boolean)))
    return [{ value: 'all', label: 'All instructors' }, { value: 'unassigned', label: 'No instructor assigned' }, ...options.map((name) => ({ value: name, label: name }))]
  }, [sections])

  const statusStyles = {
    active: 'bg-[#ECFDF5] text-[#16A34A]',
    pending: 'bg-[#FEF3C7] text-[#92400E]',
    empty: 'bg-[#F3F4F6] text-[#6B7280]',
    archived: 'bg-[#F3E8FF] text-[#7C3AED]',
    inactive: 'bg-[#F3F4F6] text-[#6B7280]',
  }

  const getStatusBadge = (status, row) => {
    const normalized = String(status || '').toLowerCase()
    let key = normalized
    if (normalized === 'active' && !row?.instructor_name) key = 'pending'
    if (normalized !== 'active' && !row?.student_count) key = 'empty'
    const style = statusStyles[key] || 'bg-[#F3F4F6] text-[#6B7280]'
    const label = key === 'pending' ? 'Pending Instructor' : key === 'empty' ? 'Empty' : key === 'archived' ? 'Archived' : 'Active'
    return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${style}`}>{label}</span>
  }

  const getInstructorBadge = (row) => {
    const name = String(row.instructor_name || '').trim()
    if (!name) {
      return <span className="inline-flex rounded-full bg-[#FEF3C7] px-3 py-1 text-xs font-semibold text-[#92400E]">No Instructor Assigned</span>
    }
    return <span className="inline-flex rounded-full bg-[#DBEAFE] px-3 py-1 text-xs font-semibold text-[#1D4ED8]">{name}</span>
  }

  const getSectionSummary = (row) => {
    const label = row.section_code ? `${row.section_code} • ${row.section_name}` : row.section_name || 'Unnamed section'
    return <div className="space-y-1"><div className="font-medium text-[#111827]">{label}</div><div className="text-xs text-[#6B7280]">{row.program || '—'} • {row.year_level || '—'}</div></div>
  }

  const getActivityCount = (row) => `${Number(row.activity_count || row.activities_count || 0) || 0} Activities`

  const getStudentCountLabel = (row) => `${Number(row.student_count || 0) || 0} Students`

  const getAssignedCabinet = (row) => row.assigned_cabinet || row.cabinet_station || row.cabinet_name || '—'

  const toggleSelection = (id) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))
  }

  const toggleSelectAllVisible = () => {
    const visibleIds = filteredSections.map((section) => section.id)
    if (selectedIds.length && visibleIds.every((id) => selectedIds.includes(id))) {
      setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)))
      return
    }
    setSelectedIds((current) => Array.from(new Set([...current, ...visibleIds])))
  }

  const openSectionDrawer = (section) => {
    setSelectedSectionForDrawer(section)
    setIsDrawerOpen(true)
  }

  const closeSectionDrawer = () => {
    setIsDrawerOpen(false)
    setSelectedSectionForDrawer(null)
  }

  const handleBulkAction = (action) => {
    if (!selectedIds.length) return
    const label = action === 'assign' ? 'Assign Instructor' : action === 'export' ? 'Export' : action === 'archive' ? 'Archive' : 'Delete'
    setToastMessage(`${label} action queued for ${selectedIds.length} section${selectedIds.length > 1 ? 's' : ''}.`)
    window.setTimeout(() => setToastMessage(''), 4000)
  }

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

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={BookOpen} title="Total Sections" value={totalSections} trendText="All sections" iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={Users} title="Students Enrolled" value={totalStudents} trendText="Across all sections" iconBg="bg-emerald-50" iconColor="text-emerald-900" />
        <SummaryCard icon={UserCog} title="Assigned Instructors" value={totalInstructors} trendText="Sections with instructors" iconBg="bg-violet-50" iconColor="text-violet-900" />
        <SummaryCard icon={Layers3} title="Average Students per Section" value={averageStudentsPerSection} trendText="Enrolled per section" iconBg="bg-amber-50" iconColor="text-amber-900" />
      </div>

      {error && (
        <div className="rounded-[12px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Section Directory</h2>
            <p className="text-sm text-[#6B7280]">Browse sections, instructor assignments, and enrollment details.</p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-[360px]">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6B7280]">
              <Search size={16} />
            </span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sections..." className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pl-10 text-sm text-slate-700 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-blue-900" />
          </label>

          <div className="flex flex-wrap gap-3 lg:justify-end">
            <label className="min-w-[160px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter instructor</span>
              <select value={instructorFilter} onChange={(e) => setInstructorFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
                {instructorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="min-w-[160px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Filter status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="pending">Pending Instructor</option>
                <option value="empty">Empty</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className="min-w-[160px] flex-1 lg:max-w-[180px]">
              <span className="sr-only">Sort by</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="h-11 w-full rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15">
                <option value="name">Name</option>
                <option value="students">Students</option>
                <option value="instructors">Instructor</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {selectedIds.length > 0 && (
              <>
                <button type="button" onClick={() => handleBulkAction('assign')} className="rounded-[8px] border border-[#D1D5DB] bg-white px-3 py-2 text-sm font-semibold text-[#374151]">Assign Instructor</button>
                <button type="button" onClick={() => handleBulkAction('export')} className="rounded-[8px] border border-[#D1D5DB] bg-white px-3 py-2 text-sm font-semibold text-[#374151]">Export</button>
                <button type="button" onClick={() => handleBulkAction('archive')} className="rounded-[8px] border border-[#D1D5DB] bg-white px-3 py-2 text-sm font-semibold text-[#374151]">Archive</button>
                <button type="button" onClick={() => handleBulkAction('delete')} className="rounded-[8px] border border-[#DC2626] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#DC2626]">Delete</button>
              </>
            )}
          </div>
          <div className="text-sm text-slate-500">{filteredSections.length} result{filteredSections.length === 1 ? '' : 's'}</div>
        </div>

        <div className="overflow-x-auto rounded-[12px] border border-[#E5E7EB]">
          <table className="min-w-full divide-y divide-[#E5E7EB] text-sm">
            <thead className="bg-[#F9FAFB]">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input type="checkbox" checked={filteredSections.length > 0 && filteredSections.every((section) => selectedIds.includes(section.id))} onChange={toggleSelectAllVisible} className="h-4 w-4 rounded border-[#D1D5DB]" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Section</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Instructor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Students</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Activities</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Assigned Cabinet</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB] bg-white">
              {loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[#6B7280]">Loading sections…</td></tr>
              )}
              {!loading && !filteredSections.length && (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-[#6B7280]">No sections available.</td></tr>
              )}
              {!loading && filteredSections.map((section) => (
                <tr key={section.id} className="transition hover:bg-[#F9FAFB]">
                  <td className="px-4 py-4"><input type="checkbox" checked={selectedIds.includes(section.id)} onChange={() => toggleSelection(section.id)} className="h-4 w-4 rounded border-[#D1D5DB]" /></td>
                  <td className="px-4 py-4">{getSectionSummary(section)}</td>
                  <td className="px-4 py-4">{getInstructorBadge(section)}</td>
                  <td className="px-4 py-4 text-[#374151]">{getStudentCountLabel(section)}</td>
                  <td className="px-4 py-4 text-[#374151]">{getActivityCount(section)}</td>
                  <td className="px-4 py-4 text-[#374151]">{getAssignedCabinet(section)}</td>
                  <td className="px-4 py-4">{getStatusBadge(section.status, section)}</td>
                  <td className="px-4 py-4">
                    <div className="relative" ref={openActionId === section.id ? actionMenuRef : null}>
                      <button type="button" onClick={() => setOpenActionId((current) => (current === section.id ? null : section.id))} className="flex h-9 w-9 items-center justify-center rounded-full border border-[#D1D5DB] bg-white text-[#374151] transition hover:bg-[#F9FAFB]" aria-label="Open section actions">
                        <MoreHorizontal size={16} />
                      </button>
                      {openActionId === section.id && (
                        <div className="absolute right-0 z-30 mt-2 w-48 rounded-[10px] border border-[#E5E7EB] bg-white p-2 shadow-lg">
                          <button type="button" onClick={() => { setOpenActionId(null); openSectionDrawer(section) }} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6]">
                            <Eye size={14} />View Details
                          </button>
                          <button type="button" onClick={() => { setOpenActionId(null); handleOpenEditModal(section.id, section) }} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6]">
                            <Edit2 size={14} />Edit Section
                          </button>
                          <button type="button" onClick={() => { setOpenActionId(null); handleOpenDeleteModal(section) }} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#DC2626] transition hover:bg-[#FEF2F2]">
                            <Trash2 size={14} />Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      {isDrawerOpen && selectedSectionForDrawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
          <div className="h-full w-full max-w-md border-l border-[#E5E7EB] bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-[#2563EB]">Section Details</p>
                <h3 className="mt-1 text-xl font-semibold text-[#111827]">{selectedSectionForDrawer.section_name || 'Section Details'}</h3>
              </div>
              <button type="button" onClick={closeSectionDrawer} className="rounded-full border border-[#D1D5DB] px-3 py-2 text-sm text-[#374151]">Close</button>
            </div>
            <div className="mt-6 space-y-4 text-sm text-[#374151]">
              <div className="rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Overview</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-[#DBEAFE] px-3 py-1 text-xs font-semibold text-[#1D4ED8]">{selectedSectionForDrawer.section_code || 'No code'}</span>
                  <span className="rounded-full bg-[#ECFDF5] px-3 py-1 text-xs font-semibold text-[#16A34A]">{selectedSectionForDrawer.program || 'No program'}</span>
                  <span className="rounded-full bg-[#FEF3C7] px-3 py-1 text-xs font-semibold text-[#92400E]">{selectedSectionForDrawer.year_level || 'No year level'}</span>
                </div>
              </div>
              <div className="rounded-[10px] border border-[#E5E7EB] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Instructor</div>
                <div className="mt-2 font-medium text-[#111827]">{selectedSectionForDrawer.instructor_name || 'No Instructor Assigned'}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[10px] border border-[#E5E7EB] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Students</div>
                  <div className="mt-2 text-lg font-semibold text-[#111827]">{selectedSectionForDrawer.student_count || 0}</div>
                </div>
                <div className="rounded-[10px] border border-[#E5E7EB] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Activities</div>
                  <div className="mt-2 text-lg font-semibold text-[#111827]">{selectedSectionForDrawer.activity_count || 0}</div>
                </div>
              </div>
              <div className="rounded-[10px] border border-[#E5E7EB] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Assigned Cabinet</div>
                <div className="mt-2 font-medium text-[#111827]">{getAssignedCabinet(selectedSectionForDrawer)}</div>
              </div>
              <div className="rounded-[10px] border border-[#E5E7EB] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Status</div>
                <div className="mt-2">{getStatusBadge(selectedSectionForDrawer.status, selectedSectionForDrawer)}</div>
              </div>
            </div>
          </div>
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
