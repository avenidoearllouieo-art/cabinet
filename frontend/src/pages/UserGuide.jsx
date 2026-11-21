import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, BookOpen, CheckCircle2, CircleHelp, ClipboardList,
  FileUp, KeyRound, LockKeyhole, MapPin, MonitorCheck, ShieldCheck, UserRound,
  Users, Video,
} from 'lucide-react'
import InfoPageLayout from '../components/InfoPageLayout.jsx'
import api from '../services/api.js'

const roles = {
  student: {
    label: 'Student',
    icon: UserRound,
    intro: 'Find assigned work, submit files, and review cabinet activity connected to your account.',
    steps: [
      [LockKeyhole, 'Sign in', 'Use your assigned username and password. Choose Student Login from the sign-in page. Use Forgot password? to begin cabinet-verified recovery.'],
      [ClipboardList, 'View assigned activities', 'Open Activities to see work assigned to your section, due dates, instructor attachments, and your submission status.'],
      [FileUp, 'Submit or update work', 'Open an activity and choose Submit Activity. Add the required files, review the upload list, then submit. When resubmission is allowed, use Edit Submission to replace or add files.'],
      [BookOpen, 'Preview or download attachments', 'Open an activity or submission and use its attachment list to preview supported files or download the original. Video previews are available from the submission viewer when the browser supports the format.'],
      [CheckCircle2, 'Read submission statuses', 'Activities can be pending, submitted, overdue, due today, late, or closed. Submission History shows review, graded, and returned-for-revision states when available.'],
      [ShieldCheck, 'Register an NFC card', 'Open the registration link or QR supplied for your account and complete the form. Registration tokens are temporary; keep them private.'],
      [MonitorCheck, 'Use cabinet access', 'Tap your registered card at the cabinet reader. Your allowed access events appear in Access Logs; contact your instructor if a scan is rejected.'],
      [KeyRound, 'Recover your password', 'Start Forgot password? with your Student ID and registered email. Select your name from the pending requests on the Cabinet UI, start NFC recovery, then tap your registered card. Choose a new password on the web page after verification.'],
    ],
  },
  instructor: {
    label: 'Instructor',
    icon: BookOpen,
    intro: 'Create section-based activities, review student work, and monitor assigned cabinet access.',
    steps: [
      [LockKeyhole, 'Sign in', 'Use your assigned username and password from the standard sign-in page.'],
      [ClipboardList, 'Create an activity', 'Open Activities and choose Add Activity. Enter its title and instructions, select sections, set a deadline, and attach any learning materials.'],
      [CheckCircle2, 'Save or publish', 'Save as Draft to continue later. Choose Publish Activity when it is ready to appear for assigned students.'],
      [Users, 'Assign sections', 'Select the sections in the activity workflow. Your activity list and section views remain limited to your assigned teaching scope.'],
      [Activity, 'Review submissions', 'Open Submissions to search by student or activity and filter by section, activity, and status. Open a record to review files; use Grade to enter a score and optional feedback.'],
      [Video, 'Preview submitted videos', 'Open a submission and select a supported video attachment to preview it. Download remains available from the attachment controls.'],
      [MonitorCheck, 'Read statistics', 'The dashboard summarizes your activities and submissions. Submission statistics show totals, pending review, and graded work for the selected scope.'],
      [ShieldCheck, 'Check cabinet access', 'Open Access Logs to review cabinet events from students in your assigned sections. Student identifiers are scoped to your teaching access.'],
    ],
  },
}

const faqs = [
  ['An activity is missing. What should I check?', 'Students should confirm that their account is assigned to the correct section and that the instructor has published the activity. Instructors should check the activity section assignments.'],
  ['What should I do if the ID card is not detected?', 'Clean the card area, hold the card steadily over the reader, and ask authorized personnel to check the cabinet connection.'],
  ['What should I do if the registration session expired?', 'Tap your authorized ID card again at the cabinet to start a fresh, short-lived QR session.'],
  ['How does password recovery work?', 'The account holder starts a request with their registered account details, then taps their own registered NFC card through the cabinet verification flow. Tapping another person’s card cannot authorize recovery for the selected account.'],
  ['Who can view cabinet access records?', 'Students see their own access history. Instructors see records for students in their assigned sections.'],
]

export default function UserGuide() {
  const [selectedRole, setSelectedRole] = useState('student')
  const [location, setLocation] = useState({
    institution_name: 'University of Science and Technology of Southern Philippines',
    college_name: 'College of Information Technology and Computing',
    building_name: 'CITC Building',
    location_description: 'Hallway near the CITC Office',
  })
  useEffect(() => {
    api.get('/cabinet/location/')
      .then((response) => {
        if (response.data) setLocation(response.data)
      })
      .catch(() => {})
  }, [])
  const role = roles[selectedRole]
  const RoleIcon = role.icon

  return (
    <InfoPageLayout
      eyebrow="Help & Information"
      title="TapTrack User Guide"
      description="A practical guide to account access, coursework workflows, and NFC-enabled cabinet features. Choose a role to see its available actions."
    >
      <section className="border-b border-[#cbd8e6] py-7">
        <h2 className="text-xl font-bold text-[#082B53]">How to Register</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-2">
          {[
            'Tap your authorized ID card at the cabinet NFC reader.',
            'Follow the instructions shown on the Cabinet UI.',
            'Scan the registration QR code using your phone.',
            'Open the TapTrack registration page.',
            'Enter your authorized ID number and email address.',
            'Create your username and password.',
            'Confirm your password and complete the secure identity check.',
            'Wait for the registration success message, then log in.',
          ].map((text, index) => <li key={text} className="rounded-md border border-[#dbe5f0] bg-white p-4 text-sm leading-6 text-[#526780]"><span className="mr-2 font-bold text-[#a66e00]">{index + 1}.</span>{text}</li>)}
        </ol>
      </section>

      <section className="border-b border-[#cbd8e6] py-7">
        <h2 className="flex items-center gap-2 text-xl font-bold text-[#082B53]"><MapPin size={21} aria-hidden="true" />Where Is the TapTrack Cabinet Located?</h2>
        <p className="mt-3 text-sm leading-7 text-[#526780]">4th Floor Hallway, near the College of Information Technology and Computing (CITC) Office, University of Science and Technology of Southern Philippines (USTP).</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {[['Institution', location.institution_name], ['College', location.college_name], ['Building', location.building_name], ['Location', location.location_description]].map(([label, value]) => <div key={label} className="rounded-md border border-[#dbe5f0] bg-white p-4"><dt className="text-xs font-bold uppercase text-[#526780]">{label}</dt><dd className="mt-1 font-semibold text-[#082B53]">{value}</dd></div>)}
        </dl>
        <p className="mt-4 text-sm leading-6 text-[#526780]">If you cannot locate the cabinet, please contact an authorized TapTrack administrator or CITC personnel.</p>
      </section>

      <div className="flex flex-wrap gap-2 border-b border-[#cbd8e6] py-5" role="group" aria-label="Choose guide role">
        {Object.entries(roles).map(([key, item]) => {
          const Icon = item.icon
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selectedRole === key}
              onClick={() => setSelectedRole(key)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#082B53] ${selectedRole === key ? 'border-[#082B53] bg-[#082B53] text-white' : 'border-[#cbd8e6] bg-white text-[#082B53] hover:bg-[#EAF2FB]'}`}
            >
              <Icon size={17} aria-hidden="true" />{item.label}
            </button>
          )
        })}
      </div>

      <section className="py-7" aria-live="polite">
        <div className="flex items-start gap-4 border-l-4 border-[#FFBE0B] pl-4">
          <RoleIcon className="mt-1 shrink-0 text-[#082B53]" size={22} aria-hidden="true" />
          <div>
            <h2 className="text-xl font-bold text-[#082B53]">{role.label} tasks</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#526780]">{role.intro}</p>
          </div>
        </div>
        <ol className="mt-6 grid gap-3 md:grid-cols-2">
          {role.steps.map(([Icon, title, description], index) => (
            <li key={title} className="flex min-w-0 gap-4 rounded-md border border-[#dbe5f0] bg-white p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#EAF2FB] text-[#082B53]" aria-hidden="true"><Icon size={18} /></span>
              <div className="min-w-0">
                <h3 className="font-semibold text-[#082B53]"><span className="text-[#a66e00]">{index + 1}.</span>{' '}{title}</h3>
                <p className="mt-1 text-sm leading-6 text-[#526780]">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-[#cbd8e6] py-7">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[#082B53]"><CircleHelp size={20} aria-hidden="true" />Frequently asked questions</h2>
        <div className="mt-4 divide-y divide-[#dbe5f0] border-y border-[#dbe5f0] bg-white">
          {faqs.map(([question, answer]) => (
            <details key={question} className="group px-4 py-4">
              <summary className="cursor-pointer list-none pr-6 text-sm font-semibold text-[#082B53] marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#082B53]">{question}</summary>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-[#526780]">{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="border-t border-[#cbd8e6] py-7">
        <h2 className="text-lg font-bold text-[#082B53]">Safety and Security</h2>
        <ul className="mt-3 grid gap-2 text-sm leading-6 text-[#526780] sm:grid-cols-2">
          <li>Keep passwords private.</li>
          <li>Do not lend ID cards to unauthorized users.</li>
          <li>Do not force cabinet components.</li>
          <li>Follow cabinet access instructions.</li>
          <li>Report damaged equipment.</li>
          <li>Contact authorized personnel for assistance.</li>
        </ul>
      </section>

      <p className="border-l-4 border-[#FFBE0B] bg-[#EAF2FB] px-4 py-3 text-sm leading-6 text-[#28415f]">
        Need to sign in? <Link to="/" className="font-semibold text-[#082B53] underline underline-offset-2">Return to the TapTrack login page.</Link>
      </p>
    </InfoPageLayout>
  )
}