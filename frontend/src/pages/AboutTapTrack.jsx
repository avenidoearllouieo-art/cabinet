import {
  Boxes, CircuitBoard, Cloud, Cpu, Fingerprint, GraduationCap,
  Monitor, Server, Video,
} from 'lucide-react'
import InfoPageLayout from '../components/InfoPageLayout.jsx'
import TapTrackLogo from '../components/TapTrackLogo.jsx'

const architecture = [
  { icon: Monitor, name: 'React dashboard', detail: 'Role-based Admin, Instructor, and Student portals for activities, submissions, accounts, and access history.' },
  { icon: Server, name: 'Django REST API', detail: 'Authentication, scoped permissions, academic records, password recovery, and file-access authorization.' },
  { icon: Fingerprint, name: 'Raspberry Pi NFC service', detail: 'Reads NFC scans and coordinates cabinet verification and recovery with Django using device credentials kept on the Pi.' },
  { icon: Cpu, name: 'ESP32 controller', detail: 'A separate motor-control firmware prototype communicates with the Pi service. Physical actuation is disarmed by default.' },
  { icon: Cloud, name: 'Django media and Tigris', detail: 'Attachments use Django’s configured media storage. Hosted deployments can use Tigris S3-compatible object storage for larger video uploads.' },
]

const roles = [
  ['Admin', 'Maintains user accounts, sections, instructor assignments, and system-wide monitoring.'],
  ['Instructor', 'Creates and publishes section-based activities, then reviews and grades student submissions.'],
  ['Student', 'Views assigned activities, submits or updates work, and checks personal submission and cabinet history.'],
]

export default function AboutTapTrack() {
  return (
    <InfoPageLayout
      eyebrow="Capstone Project"
      title="About TapTrack"
      description="An NFC-enabled cabinet access and coursework tracking system designed to connect physical cabinet use with clear, role-based academic workflows."
    >
      <section className="grid items-start gap-8 border-b border-[#cbd8e6] pb-9 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex items-center gap-4">
          <TapTrackLogo compact className="h-16 w-16 shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase text-[#a66e00]">The project</p>
            <h2 className="mt-1 text-2xl font-bold text-[#082B53]">TapTrack</h2>
          </div>
        </div>
        <div className="space-y-4 text-sm leading-7 text-[#526780]">
          <p>TapTrack is a capstone project combining cabinet access monitoring with digital activity and submission management. Its purpose is to make cabinet use traceable while giving students and instructors one place to manage coursework.</p>
          <p>The project cabinet is located at the University of Science and Technology of Southern Philippines (USTP), Cagayan de Oro, CITC 4th Floor. The web application records role-scoped activity, submission, and cabinet information. NFC registration links a user account to a card; cabinet scans are verified by the Django API before access outcomes are recorded.</p>
        </div>
      </section>

      <section className="grid gap-8 border-b border-[#cbd8e6] py-8 md:grid-cols-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[#082B53]"><GraduationCap size={21} aria-hidden="true" />Academic workflow</h2>
          <p className="mt-3 text-sm leading-6 text-[#526780]">Instructors create drafts, publish activities to sections, attach materials, and review student files. Students submit or update work and follow its status and instructor feedback. Administrators manage the accounts and section assignments that scope those workflows.</p>
        </div>
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[#082B53]"><Boxes size={21} aria-hidden="true" />NFC and access monitoring</h2>
          <p className="mt-3 text-sm leading-6 text-[#526780]">Registered NFC cards are checked through the Raspberry Pi service and Django API. The cabinet automatically attempts to capture a photo for an access event; its status and any available image are associated with that access record and shown according to the user’s role permissions. A camera failure does not change the NFC access result. Password recovery uses a separate cabinet-verified NFC flow.</p>
        </div>
      </section>

      <section className="border-b border-[#cbd8e6] py-8">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[#082B53]"><Video size={21} aria-hidden="true" />Submission files and video</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-[#526780]">Activity materials and student submission files are served through authorized attachment workflows. Video uploads support the project’s storage-backed multipart flow; Django uses its configured media backend, with Tigris S3-compatible storage available for hosted deployments.</p>
      </section>

      <section className="border-b border-[#cbd8e6] py-8">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[#082B53]"><CircuitBoard size={21} aria-hidden="true" />System architecture</h2>
        <p className="mt-2 text-sm leading-6 text-[#526780]">The web and hardware services have distinct responsibilities; the API is the authority for identity, permissions, and academic records.</p>
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {architecture.map(({ icon: Icon, name, detail }) => (
            <li key={name} className="flex gap-4 rounded-md border border-[#dbe5f0] bg-white p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#EAF2FB] text-[#082B53]" aria-hidden="true"><Icon size={18} /></span>
              <div><h3 className="font-semibold text-[#082B53]">{name}</h3><p className="mt-1 text-sm leading-6 text-[#526780]">{detail}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-8 py-8 md:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 className="text-lg font-bold text-[#082B53]">Three roles, one workflow</h2>
          <ul className="mt-4 space-y-3">
            {roles.map(([role, detail]) => <li key={role} className="border-l-2 border-[#FFBE0B] pl-3"><h3 className="text-sm font-bold text-[#082B53]">{role}</h3><p className="mt-1 text-sm leading-6 text-[#526780]">{detail}</p></li>)}
          </ul>
        </div>
        <div className="border-t border-[#cbd8e6] pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
          <h2 className="text-lg font-bold text-[#082B53]">Acknowledgments</h2>
          <p className="mt-2 text-sm leading-6 text-[#526780]">Editable placeholders for the capstone presentation:</p>
          <ul className="mt-4 space-y-2 text-sm text-[#28415f]">
            <li><span className="font-semibold">Project team:</span> [Project Team Members]</li>
            <li><span className="font-semibold">Faculty adviser:</span> [Faculty Adviser]</li>
            <li><span className="font-semibold">Department / institution:</span> [Department or Institution]</li>
            <li><span className="font-semibold">Project partners:</span> [Acknowledged Partners]</li>
          </ul>
        </div>
      </section>
    </InfoPageLayout>
  )
}