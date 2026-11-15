import { useEffect, useMemo, useState } from 'react'
import api from '../../services/api.js'
import PageHeader from '../../components/PageHeader'
import SummaryCard from '../../components/SummaryCard'
import StatusBadge from '../../components/StatusBadge'
import SectionOverviewModal from '../../components/sections/SectionOverviewModal.jsx'
import AddSectionModal from '../../components/sections/AddSectionModal.jsx'
import EditSectionModal from '../../components/sections/EditSectionModal.jsx'
import DeleteSectionModal from '../../components/sections/DeleteSectionModal.jsx'
import AssignInstructorModal from '../../components/sections/AssignInstructorModal.jsx'
import AnchoredMenu from '../../components/users/AnchoredMenu.jsx'
import { fetchAllResults } from '../../services/paginatedResults.js'
import { Search, BookOpen, Edit2, Trash2, Plus, MoreHorizontal, Eye, Users, UserCog, ChevronDown, ChevronRight } from 'lucide-react'

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
  const [selectedIds, setSelectedIds] = useState([])
  const [openActionId, setOpenActionId] = useState(null)
  const [openActionLayout, setOpenActionLayout] = useState(null)
  const [selectedSectionForDrawer, setSelectedSectionForDrawer] = useState(null)
  const [isAssignInstructorOpen, setIsAssignInstructorOpen] = useState(false)
  const [assignmentSections, setAssignmentSections] = useState([])
  const [instructorFilter, setInstructorFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [expandedSections, setExpandedSections] = useState(new Set())
  const [sectionStudents, setSectionStudents] = useState(new Map())
  const [loadingStudentSections, setLoadingStudentSections] = useState(new Set())
  const [studentErrors, setStudentErrors] = useState(new Map())

  const fetchSections = async () => {
    try {
      setLoading(true)
      const { results } = await fetchAllResults(api, '/sections/')
      setSections(results)
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

  const handleSectionAdded = (newSection) => {
    if (!newSection || !newSection.id) {
      fetchSections()
      return
    }

    setSections((prev) => [newSection, ...prev])
    void fetchSections()
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
    void fetchSections()

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
        [section.subject_code, section.section_name, section.year_level, section.academic_year, section.program, section.instructor_name]
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
  const totalInstructors = new Set(sections.map((section) => section.instructor ?? section.instructor_name).filter(Boolean)).size

  const programOptions = useMemo(() => Array.from(new Set(sections.map((section) => section.program).filter(Boolean))).sort(), [sections])
  const yearLevelOptions = useMemo(() => Array.from(new Set(sections.map((section) => section.year_level).filter(Boolean))).sort(), [sections])

  const instructorOptions = useMemo(() => {
    const options = Array.from(new Set(sections.map((section) => String(section.instructor_name || '').trim()).filter(Boolean)))
    return [{ value: 'all', label: 'All instructors' }, { value: 'unassigned', label: 'No instructor assigned' }, ...options.map((name) => ({ value: name, label: name }))]
  }, [sections])

  const getStatusBadge = (status) => {
    const normalized = String(status || '').toLowerCase()
    const label = normalized === 'active' ? 'Active' : normalized === 'inactive' ? 'Inactive' : status || 'Unknown'
    return <StatusBadge status={normalized} label={label} />
  }

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
  }

  const closeSectionDrawer = () => {
    setSelectedSectionForDrawer(null)
  }

  const editDrawerSection = () => {
    const section = selectedSectionForDrawer
    if (!section) return
    closeSectionDrawer()
    window.setTimeout(() => handleOpenEditModal(section.id, section), 0)
  }

  const assignDrawerInstructor = () => {
    const section = selectedSectionForDrawer
    if (!section) return
    closeSectionDrawer()
    window.setTimeout(() => openAssignInstructor(section), 0)
  }

  const deleteDrawerSection = () => {
    const section = selectedSectionForDrawer
    if (!section) return
    closeSectionDrawer()
    window.setTimeout(() => handleOpenDeleteModal(section), 0)
  }

  const openAssignInstructor = (section) => {
    const selected = section ? [section] : sections.filter((item) => selectedIds.includes(item.id))
    if (!selected.length) return
    setAssignmentSections(selected)
    setIsAssignInstructorOpen(true)
  }

  const toggleStudentList = async (section) => {
    const sectionId = section.id
    if (expandedSections.has(sectionId)) {
      setExpandedSections((current) => {
        const next = new Set(current)
        next.delete(sectionId)
        return next
      })
      return
    }

    setExpandedSections((current) => new Set(current).add(sectionId))
    if (sectionStudents.has(sectionId) || loadingStudentSections.has(sectionId)) return

    setLoadingStudentSections((current) => new Set(current).add(sectionId))
    setStudentErrors((current) => new Map(current).set(sectionId, ''))
    try {
      const { results } = await fetchAllResults(api, '/users/', { role: 'student', section: sectionId })
      setSectionStudents((current) => new Map(current).set(sectionId, results))
    } catch (requestError) {
      console.error('Error fetching students for section:', requestError)
      setStudentErrors((current) => new Map(current).set(sectionId, 'Students could not be loaded.'))
    } finally {
      setLoadingStudentSections((current) => {
        const next = new Set(current)
        next.delete(sectionId)
        return next
      })
    }
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

  const renderStudentRoster = (section) => {
    const students = sectionStudents.get(section.id)
    if (loadingStudentSections.has(section.id)) return <p className="p-4 text-sm text-slate-500">Loading students…</p>
    if (studentErrors.get(section.id)) return <p role="alert" className="p-4 text-sm text-red-700">{studentErrors.get(section.id)}</p>
    if (!students?.length) return <p className="p-4 text-sm text-slate-500">No students enrolled.</p>

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="bg-[#eaf2fb] text-[#526780]">
            <tr><th className="px-3 py-2 font-semibold">Student Name</th><th className="px-3 py-2 font-semibold">Student ID</th><th className="px-3 py-2 font-semibold">Year Level</th><th className="px-3 py-2 font-semibold">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-[#dbe5f0] bg-white">
            {students.map((student) => (
              <tr key={student.id}>
                <td className="px-3 py-2 font-medium text-[#102a4c]">{`${student.first_name || ''} ${student.last_name || ''}`.trim() || student.username || 'Unnamed student'}</td>
                <td className="px-3 py-2 text-slate-600">{student.student_id || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{student.section_year_level || section.year_level || '—'}</td>
                <td className="px-3 py-2"><StatusBadge status={student.is_active ? 'active' : 'inactive'} label={student.is_active ? 'Active' : 'Inactive'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderSectionActions = (section, layout) => (
    <AnchoredMenu
      open={openActionId === section.id && openActionLayout === layout}
      onOpenChange={(open) => {
        setOpenActionId(open ? section.id : null)
        setOpenActionLayout(open ? layout : null)
      }}
      ariaLabel={`${section.section_name || 'Section'} actions`}
      renderTrigger={(props) => <button {...props} type="button" className="flex h-9 w-9 items-center justify-center rounded-md border border-[#dbe5f0] bg-white text-[#374151] hover:bg-[#f3f6fa]" aria-label={`Open actions for ${section.section_name || 'section'}`}><MoreHorizontal size={16} /></button>}
    >
      <button type="button" role="menuitem" onClick={() => { setOpenActionId(null); openSectionDrawer(section) }} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[#111827] hover:bg-[#f3f6fa]"><Eye size={14} />View Details</button>
      <button type="button" role="menuitem" onClick={() => { setOpenActionId(null); handleOpenEditModal(section.id, section) }} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[#111827] hover:bg-[#f3f6fa]"><Edit2 size={14} />Edit Section</button>
      <button type="button" role="menuitem" onClick={() => { setOpenActionId(null); openAssignInstructor(section) }} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[#111827] hover:bg-[#f3f6fa]"><UserCog size={14} />Assign Instructor</button>
      <button type="button" role="menuitem" onClick={() => { setOpenActionId(null); handleOpenDeleteModal(section) }} className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"><Trash2 size={14} />Delete</button>
    </AnchoredMenu>
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
            className="tt-button tt-button-primary"
          >
            <Plus size={16} />
            Add Section
          </button>
        }
      />

      <div className="dashboard-stat-grid grid grid-cols-1 gap-2.5 sm:grid-cols-3 lg:gap-4">
        <SummaryCard icon={BookOpen} title="Total Sections" value={totalSections} trendText="All sections" iconBg="bg-blue-50" iconColor="text-blue-900" />
        <SummaryCard icon={Users} title="Students Enrolled" value={totalStudents} trendText="Across all sections" iconBg="bg-emerald-50" iconColor="text-emerald-900" />
        <SummaryCard icon={UserCog} title="Assigned Instructors" value={totalInstructors} trendText="Unique assigned instructors" iconBg="bg-amber-50" iconColor="text-amber-900" />
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

        <div className="mb-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <label className="relative block min-w-0">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6B7280]">
              <Search size={16} />
            </span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sections" aria-label="Search sections" className="tt-control w-full pl-10" />
          </label>
          <label className="min-w-0"><span className="sr-only">Filter program</span><select value={programFilter} onChange={(event) => setProgramFilter(event.target.value)} className="tt-control w-full"><option value="all">All programs</option>{programOptions.map((program) => <option key={program} value={program}>{program}</option>)}</select></label>
          <label className="min-w-0"><span className="sr-only">Filter year level</span><select value={yearLevelFilter} onChange={(event) => setYearLevelFilter(event.target.value)} className="tt-control w-full"><option value="all">All year levels</option>{yearLevelOptions.map((yearLevel) => <option key={yearLevel} value={yearLevel}>{yearLevel}</option>)}</select></label>
          <label className="min-w-0"><span className="sr-only">Filter instructor</span><select value={instructorFilter} onChange={(event) => setInstructorFilter(event.target.value)} className="tt-control w-full">{instructorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="min-w-0"><span className="sr-only">Filter status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="tt-control w-full"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          <label className="min-w-0"><span className="sr-only">Sort by</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="tt-control w-full"><option value="name">Section name</option><option value="students">Students</option><option value="instructors">Instructor</option></select></label>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {selectedIds.length > 0 && (
              <>
                <button type="button" onClick={() => openAssignInstructor()} className="tt-button tt-button-primary min-h-10">Assign Instructor ({selectedIds.length})</button>
                <button type="button" onClick={() => setSelectedIds([])} className="tt-button tt-button-secondary min-h-10">Clear selection</button>
              </>
            )}
          </div>
          <div className="text-sm text-slate-500">{filteredSections.length} result{filteredSections.length === 1 ? '' : 's'}</div>
        </div>

        <div className="space-y-2 lg:hidden" aria-label="Section records">
          {loading && <p className="rounded-lg bg-[#F9FAFB] px-3 py-5 text-center text-sm text-[#6B7280]">Loading sections…</p>}
          {!loading && !filteredSections.length && <p className="rounded-lg bg-[#F9FAFB] px-3 py-5 text-center text-sm text-[#6B7280]">No sections available.</p>}
          {!loading && filteredSections.map((section) => (
            <article key={section.id} className="min-w-0 rounded-lg border border-[#dbe5f0] bg-white p-3 shadow-sm">
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => toggleStudentList(section)} aria-expanded={expandedSections.has(section.id)} aria-label={`${expandedSections.has(section.id) ? 'Hide' : 'Show'} students for ${section.section_name}`} className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#082b53] hover:bg-[#eaf2fb]">
                  {expandedSections.has(section.id) ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                </button>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(section.id)}
                  onChange={() => toggleSelection(section.id)}
                  aria-label={`Select ${section.section_name || 'section'}`}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-[#D1D5DB]"
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-[#102a4c]">{section.section_name || 'Unnamed section'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{section.subject_code || 'No section code'}</p>
                </div>
                {renderSectionActions(section, 'mobile')}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[#dbe5f0] pt-3 text-xs">
                <div><dt className="text-slate-500">Program</dt><dd className="mt-0.5 font-medium text-slate-800">{section.program || '—'}</dd></div>
                <div><dt className="text-slate-500">Year Level</dt><dd className="mt-0.5 font-medium text-slate-800">{section.year_level || '—'}</dd></div>
                <div><dt className="text-slate-500">Academic Year</dt><dd className="mt-0.5 font-medium text-slate-800">{section.academic_year || '—'}</dd></div>
                <div><dt className="text-slate-500">Instructor</dt><dd className="mt-0.5 break-words font-medium text-slate-800">{section.instructor_name || 'Unassigned'}</dd></div>
                <div><dt className="text-slate-500">Students</dt><dd className="mt-0.5 font-medium text-slate-800">{section.student_count ?? 0}</dd></div>
                <div><dt className="text-slate-500">Activities</dt><dd className="mt-0.5 font-medium text-slate-800">{section.activity_count ?? 0}</dd></div>
                <div><dt className="text-slate-500">Status</dt><dd className="mt-1">{getStatusBadge(section.status)}</dd></div>
              </dl>
              {expandedSections.has(section.id) && <div className="mt-3 overflow-hidden rounded-md border border-[#dbe5f0] bg-[#f3f6fa]">{renderStudentRoster(section)}</div>}
            </article>
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border border-[#dbe5f0] lg:block">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-xs lg:min-w-0">
            <thead className="bg-[#F9FAFB]">
              <tr>
                <th className="w-[24%] border-b border-r border-[#dbe5f0] px-3 py-3 text-left font-semibold uppercase text-slate-500"><div className="flex items-center gap-2"><input type="checkbox" aria-label="Select all visible sections" checked={filteredSections.length > 0 && filteredSections.every((section) => selectedIds.includes(section.id))} onChange={toggleSelectAllVisible} className="h-4 w-4 rounded border-slate-300" />Section</div></th>
                <th className="w-[10%] border-b border-r border-[#dbe5f0] px-2 py-3 text-left font-semibold uppercase text-slate-500">Program</th>
                <th className="w-[9%] border-b border-r border-[#dbe5f0] px-2 py-3 text-left font-semibold uppercase text-slate-500">Year Level</th>
                <th className="w-[11%] border-b border-r border-[#dbe5f0] px-2 py-3 text-left font-semibold uppercase text-slate-500">Academic Year</th>
                <th className="w-[15%] border-b border-r border-[#dbe5f0] px-2 py-3 text-left font-semibold uppercase text-slate-500">Instructor</th>
                <th className="w-[8%] border-b border-r border-[#dbe5f0] px-2 py-3 text-left font-semibold uppercase text-slate-500">Students</th>
                <th className="w-[8%] border-b border-r border-[#dbe5f0] px-2 py-3 text-left font-semibold uppercase text-slate-500">Activities</th>
                <th className="w-[8%] border-b border-r border-[#dbe5f0] px-2 py-3 text-left font-semibold uppercase text-slate-500">Status</th>
                <th className="w-[7%] border-b border-[#dbe5f0] px-2 py-3 text-left font-semibold uppercase text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB] bg-white">
              {loading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-[#6B7280]">Loading sections…</td></tr>
              )}
              {!loading && !filteredSections.length && (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-[#6B7280]">No sections available.</td></tr>
              )}
              {!loading && filteredSections.map((section) => [
                <tr key={`section-${section.id}`} className="transition hover:bg-[#f8fbff]">
                  <td className="border-r border-[#dbe5f0] px-2 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <button type="button" onClick={() => toggleStudentList(section)} aria-expanded={expandedSections.has(section.id)} aria-label={`${expandedSections.has(section.id) ? 'Hide' : 'Show'} students for ${section.section_name}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#082b53] hover:bg-[#eaf2fb]">{expandedSections.has(section.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                      <input type="checkbox" checked={selectedIds.includes(section.id)} onChange={() => toggleSelection(section.id)} aria-label={`Select ${section.section_name || 'section'}`} className="h-4 w-4 shrink-0 rounded border-slate-300" />
                      <div className="min-w-0"><p className="truncate font-semibold text-[#102a4c]">{section.section_name || 'Unnamed section'}</p><p className="truncate text-xs text-slate-500">{section.subject_code || 'No code'}</p></div>
                    </div>
                  </td>
                  <td className="truncate border-r border-[#dbe5f0] px-2 py-2.5 text-slate-700">{section.program || '—'}</td>
                  <td className="truncate border-r border-[#dbe5f0] px-2 py-2.5 text-slate-700">{section.year_level || '—'}</td>
                  <td className="truncate border-r border-[#dbe5f0] px-2 py-2.5 text-slate-700">{section.academic_year || '—'}</td>
                  <td className="truncate border-r border-[#dbe5f0] px-2 py-2.5 text-slate-700">{section.instructor_name || 'Unassigned'}</td>
                  <td className="border-r border-[#dbe5f0] px-2 py-2.5 text-slate-700">{section.student_count ?? 0}</td>
                  <td className="border-r border-[#dbe5f0] px-2 py-2.5 text-slate-700">{section.activity_count ?? 0}</td>
                  <td className="border-r border-[#dbe5f0] px-2 py-2.5">{getStatusBadge(section.status)}</td>
                  <td className="px-2 py-2.5">{renderSectionActions(section, 'desktop')}</td>
                </tr>,
                expandedSections.has(section.id) && <tr key={`students-${section.id}`} className="bg-[#eef4fa]"><td colSpan={9} className="border-b border-[#dbe5f0] p-3"><div className="overflow-hidden rounded-md border border-[#dbe5f0] bg-white"><div className="border-b border-[#dbe5f0] bg-[#eaf2fb] px-3 py-2 text-xs font-semibold uppercase text-[#526780]">Enrolled Students · {section.section_name}</div>{renderStudentRoster(section)}</div></td></tr>,
              ])}
            </tbody>
          </table>
        </div>
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-green-500 px-6 py-3 text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      <SectionOverviewModal
        key={selectedSectionForDrawer?.section_id ?? selectedSectionForDrawer?.id ?? 'closed'}
        isOpen={Boolean(selectedSectionForDrawer)}
        section={selectedSectionForDrawer}
        role="admin"
        onClose={closeSectionDrawer}
        onEditSection={editDrawerSection}
        onAssignInstructor={assignDrawerInstructor}
        onDeleteSection={deleteDrawerSection}
      />

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
