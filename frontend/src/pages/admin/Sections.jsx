import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import StatusBadge from '../../components/StatusBadge'
import AddSectionModal from '../../components/sections/AddSectionModal.jsx'
import EditSectionModal from '../../components/sections/EditSectionModal.jsx'
import DeleteSectionModal from '../../components/sections/DeleteSectionModal.jsx'
import AssignInstructorModal from '../../components/sections/AssignInstructorModal.jsx'
import { Search, BookOpen, Edit2, Trash2, Plus, MoreHorizontal, Eye, Users, UserCog, Layers3, X } from 'lucide-react'

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
  const [isAssignInstructorOpen, setIsAssignInstructorOpen] = useState(false)
  const [assignmentSections, setAssignmentSections] = useState([])
  const [instructorFilter, setInstructorFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const drawerRef = useRef(null)
  const drawerCloseButtonRef = useRef(null)

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
      if (!event.target?.closest?.('[data-section-action-menu]')) setOpenActionId(null)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!isDrawerOpen) return undefined

    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => drawerCloseButtonRef.current?.focus({ preventScroll: true }), 0)
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsDrawerOpen(false)
        setSelectedSectionForDrawer(null)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(drawerRef.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') || [])]
        .filter((element) => element.getClientRects().length)
      if (!focusable.length) {
        event.preventDefault()
        drawerRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [isDrawerOpen])

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
        [section.subject_code, section.section_name, section.year_level, section.program, section.instructor_name]
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

  const getStatusBadge = (status, row) => {
    const normalized = String(status || '').toLowerCase()
    let key = normalized
    if (normalized === 'active' && !row?.instructor_name) key = 'pending'
    if (normalized !== 'active' && !row?.student_count) key = 'empty'
    const label = key === 'pending' ? 'Pending Instructor' : key === 'empty' ? 'Empty' : key === 'archived' ? 'Archived' : 'Active'
    return <StatusBadge status={key} label={label} />
  }

  const getInstructorBadge = (row) => {
    const name = String(row.instructor_name || '').trim()
    if (!name) {
      return <StatusBadge label="No Instructor Assigned" tone="warning" />
    }
    return <StatusBadge label={name} tone="info" />
  }

  const getSectionSummary = (row) => {
    const label = row.subject_code ? `${row.subject_code} • ${row.section_name}` : row.section_name || 'Unnamed section'
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

  const openAssignInstructor = () => {
    const selected = sections.filter((section) => selectedIds.includes(section.id))
    if (!selected.length) return
    setAssignmentSections(selected)
    setIsAssignInstructorOpen(true)
  }

  const handleInstructorAssigned = (updatedSections) => {
    setSections((current) => current.map((section) => {
      const updated = updatedSections.find((item) => Number(item.id) === Number(section.id))
      return updated ? { ...section, ...updated } : section
    }))
    setSelectedIds([])
    setIsAssignInstructorOpen(false)
    setAssignmentSections([])
    setToastMessage(`Instructor assigned to ${updatedSections.length} section${updatedSections.length === 1 ? '' : 's'}.`)
    window.setTimeout(() => setToastMessage(''), 4000)
  }

  const renderSectionActions = (section) => (
    <div className="relative" data-section-action-menu>
      <button
        type="button"
        onClick={() => setOpenActionId((current) => (current === section.id ? null : section.id))}
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#D1D5DB] bg-white text-[#374151] transition hover:bg-[#F9FAFB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC107] sm:h-9 sm:w-9"
        aria-label={`Open actions for ${section.section_name || 'section'}`}
        aria-expanded={openActionId === section.id}
      >
        <MoreHorizontal size={16} />
      </button>
      {openActionId === section.id && (
        <div className="absolute right-0 z-30 mt-2 w-48 rounded-[10px] border border-[#E5E7EB] bg-white p-2 shadow-lg">
          <button type="button" onClick={() => { setOpenActionId(null); openSectionDrawer(section) }} className="flex min-h-10 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#FFC107]">
            <Eye size={14} />View Details
          </button>
          <button type="button" onClick={() => { setOpenActionId(null); handleOpenEditModal(section.id, section) }} className="flex min-h-10 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#111827] transition hover:bg-[#F3F4F6] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#FFC107]">
            <Edit2 size={14} />Edit Section
          </button>
          <button type="button" onClick={() => { setOpenActionId(null); handleOpenDeleteModal(section) }} className="flex min-h-10 w-full items-center gap-2 rounded-[8px] px-3 py-2 text-sm text-[#DC2626] transition hover:bg-[#FEF2F2] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#FFC107]">
            <Trash2 size={14} />Delete
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-5 sm:space-y-6">
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

      <div className="dashboard-stat-grid grid grid-cols-2 gap-2.5 max-[319px]:grid-cols-1 min-[1024px]:grid-cols-4 lg:gap-4">
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

      <div className="rounded-[12px] border border-[#E5E7EB] bg-white p-3 shadow-sm sm:p-6">
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
                <button type="button" onClick={openAssignInstructor} className="tt-button tt-button-primary min-h-10">Assign Instructor ({selectedIds.length})</button>
                <button type="button" onClick={() => setSelectedIds([])} className="tt-button tt-button-secondary min-h-10">Clear selection</button>
              </>
            )}
          </div>
          <div className="text-sm text-slate-500">{filteredSections.length} result{filteredSections.length === 1 ? '' : 's'}</div>
        </div>

        <div className="space-y-2 min-[600px]:hidden" aria-label="Section records">
          {loading && <p className="rounded-lg bg-[#F9FAFB] px-3 py-5 text-center text-sm text-[#6B7280]">Loading sections…</p>}
          {!loading && !filteredSections.length && <p className="rounded-lg bg-[#F9FAFB] px-3 py-5 text-center text-sm text-[#6B7280]">No sections available.</p>}
          {!loading && filteredSections.map((section) => (
            <article key={section.id} className="min-w-0 rounded-lg border border-[#E5E7EB] bg-white p-3 shadow-sm">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(section.id)}
                  onChange={() => toggleSelection(section.id)}
                  aria-label={`Select ${section.section_name || 'section'}`}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-[#D1D5DB]"
                />
                <div className="min-w-0 flex-1">
                  <div className="min-w-0 break-words text-sm font-semibold text-[#111827]">{getSectionSummary(section)}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">{getInstructorBadge(section)}{getStatusBadge(section.status, section)}</div>
                </div>
                {renderSectionActions(section)}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[#E5E7EB] pt-3 text-xs">
                <div><dt className="text-[#6B7280]">Students</dt><dd className="mt-0.5 font-medium text-[#374151]">{getStudentCountLabel(section)}</dd></div>
                <div><dt className="text-[#6B7280]">Activities</dt><dd className="mt-0.5 font-medium text-[#374151]">{getActivityCount(section)}</dd></div>
                <div className="col-span-2 min-w-0"><dt className="text-[#6B7280]">Assigned Cabinet</dt><dd className="mt-0.5 break-words font-medium text-[#374151]">{getAssignedCabinet(section)}</dd></div>
              </dl>
            </article>
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-[12px] border border-[#E5E7EB] min-[600px]:block">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-[10px] sm:text-xs lg:text-sm">
            <thead className="bg-[#F9FAFB]">
              <tr>
                <th className="w-[4%] border-b border-r border-[#E5E7EB] px-1.5 py-2 text-left">
                  <input type="checkbox" checked={filteredSections.length > 0 && filteredSections.every((section) => selectedIds.includes(section.id))} onChange={toggleSelectAllVisible} className="h-4 w-4 rounded border-[#D1D5DB]" />
                </th>
                <th className="w-[16%] border-b border-r border-[#E5E7EB] px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-[#6B7280] sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Section</th>
                <th className="w-[17%] border-b border-r border-[#E5E7EB] px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-[#6B7280] sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Instructor</th>
                <th className="w-[8%] border-b border-r border-[#E5E7EB] px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-[#6B7280] sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Students</th>
                <th className="w-[8%] border-b border-r border-[#E5E7EB] px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-[#6B7280] sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Activities</th>
                <th className="w-[16%] border-b border-r border-[#E5E7EB] px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-[#6B7280] sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Assigned Cabinet</th>
                <th className="w-[14%] border-b border-r border-[#E5E7EB] px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-[#6B7280] sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Status</th>
                <th className="w-[14%] border-b border-[#E5E7EB] px-1.5 py-2 text-left text-[9px] font-semibold uppercase text-[#6B7280] sm:px-2 sm:text-[10px] lg:px-3 lg:py-3 lg:text-xs">Actions</th>
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
                  <td className="border-r border-[#E5E7EB] px-1.5 py-2 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3"><input type="checkbox" checked={selectedIds.includes(section.id)} onChange={() => toggleSelection(section.id)} className="h-4 w-4 rounded border-[#D1D5DB]" /></td>
                  <td className="break-words border-r border-[#E5E7EB] px-1.5 py-2 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{getSectionSummary(section)}</td>
                  <td className="break-words border-r border-[#E5E7EB] px-1.5 py-2 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{getInstructorBadge(section)}</td>
                  <td className="break-words border-r border-[#E5E7EB] px-1.5 py-2 text-[#374151] sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{getStudentCountLabel(section)}</td>
                  <td className="break-words border-r border-[#E5E7EB] px-1.5 py-2 text-[#374151] sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{getActivityCount(section)}</td>
                  <td className="break-words border-r border-[#E5E7EB] px-1.5 py-2 text-[#374151] sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{getAssignedCabinet(section)}</td>
                  <td className="break-words border-r border-[#E5E7EB] px-1.5 py-2 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{getStatusBadge(section.status, section)}</td>
                  <td className="px-1.5 py-2 sm:px-2 sm:py-2.5 lg:px-3 lg:py-3">{renderSectionActions(section)}</td>
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
        createPortal(
          <div className="fixed inset-0 z-[var(--tt-layer-drawer)] flex justify-end bg-[#071f41]/55 backdrop-blur-[2px]" onMouseDown={(event) => event.target === event.currentTarget && closeSectionDrawer()}>
            <button type="button" className="flex-1 cursor-default" onClick={closeSectionDrawer} aria-label="Close section details" />
            <aside ref={drawerRef} tabIndex={-1} className="flex h-full min-h-0 w-full max-w-lg flex-col overflow-hidden border-l border-[#dbe5f0] bg-[#f7f9fc] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="section-details-title" onMouseDown={(event) => event.stopPropagation()}>
              <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-[#dbe5f0] border-l-4 border-l-[#ffc107] bg-[#eef4fa] p-4 sm:p-5">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#526780]">Section Details</p>
                  <h2 id="section-details-title" className="mt-1 break-words text-xl font-bold text-[#102a4c]">{selectedSectionForDrawer.section_name || 'Section Details'}</h2>
                  <p className="mt-1 text-sm text-[#526780]">{selectedSectionForDrawer.subject_code || 'Subject code not recorded'}</p>
                  <div className="mt-2">{getStatusBadge(selectedSectionForDrawer.status, selectedSectionForDrawer)}</div>
                </div>
                <button ref={drawerCloseButtonRef} type="button" onClick={closeSectionDrawer} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#dbe5f0] bg-white text-[#526780] hover:bg-[#f3f6fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc107]" aria-label="Close section details"><X size={18} /></button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm text-[#374151] sm:p-5">
                <div className="space-y-4 pb-4">
              <div className="rounded-xl border border-[#dbe5f0] bg-[#eef4fa] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Overview</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#082b53]">{selectedSectionForDrawer.subject_code || 'No code'}</span>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{selectedSectionForDrawer.program || 'No program'}</span>
                  <span className="rounded-full bg-[#fff5d6] px-3 py-1 text-xs font-semibold text-[#8a5900]">{selectedSectionForDrawer.year_level || 'No year level'}</span>
                </div>
              </div>
              <div className="rounded-xl border border-[#dbe5f0] bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Instructor</div>
                <div className="mt-2 font-medium text-[#111827]">{selectedSectionForDrawer.instructor_name || 'No Instructor Assigned'}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#dbe5f0] bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Students</div>
                  <div className="mt-2 text-lg font-semibold text-[#111827]">{selectedSectionForDrawer.student_count || 0}</div>
                </div>
                <div className="rounded-xl border border-[#dbe5f0] bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Activities</div>
                  <div className="mt-2 text-lg font-semibold text-[#111827]">{selectedSectionForDrawer.activity_count || 0}</div>
                </div>
              </div>
              <div className="rounded-xl border border-[#dbe5f0] bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Assigned Cabinet</div>
                <div className="mt-2 font-medium text-[#111827]">{getAssignedCabinet(selectedSectionForDrawer)}</div>
              </div>
                </div>
              </div>
            </aside>
          </div>
          , document.body,
        )
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
      <AssignInstructorModal
        isOpen={isAssignInstructorOpen}
        sections={assignmentSections}
        onClose={() => {
          setIsAssignInstructorOpen(false)
          setAssignmentSections([])
        }}
        onUnauthorized={() => {
          setIsAssignInstructorOpen(false)
          setAssignmentSections([])
        }}
        onAssigned={handleInstructorAssigned}
      />
    </div>
  )
}
