import { useEffect, useState } from 'react'
import {
  Boxes, CircuitBoard, Cpu, Fingerprint, GraduationCap, MapPin,
  Monitor, Server, Video,
} from 'lucide-react'
import api from '../services/api.js'
import InfoPageLayout from '../components/InfoPageLayout.jsx'
import TapTrackLogo from '../components/TapTrackLogo.jsx'

const architecture = [
  { icon: Monitor, name: 'React dashboard', detail: 'Role-based Admin, Instructor, and Student portals for activities, submissions, accounts, and access history.' },
  { icon: Server, name: 'Django REST API', detail: 'Authentication, scoped permissions, academic records, password recovery, and file-access authorization.' },
  { icon: Fingerprint, name: 'Raspberry Pi NFC service', detail: 'Reads NFC scans and coordinates cabinet verification and recovery with Django using device credentials kept on the Pi.' },
  { icon: Cpu, name: 'ESP32 controller', detail: 'A separate motor-control firmware prototype communicates with the Pi service. Physical actuation is disarmed by default.' },
]

const roles = [
  ['Admin', 'Maintains user accounts, sections, instructor assignments, and system-wide monitoring.'],
  ['Instructor', 'Creates and publishes section-based activities, then reviews and grades student submissions.'],
  ['Student', 'Views assigned activities, submits or updates work, and checks personal submission and cabinet history.'],
]

const documentedLocation = {
  institution_name: 'University of Science and Technology of Southern Philippines',
  college_name: 'College of Information Technology and Computing',
  building_name: 'CITC Building',
  location_description: 'Hallway near the CITC Office',
  purpose: 'Laboratory Equipment Storage and Monitoring',
}

export default function AboutTapTrack() {
  const [location, setLocation] = useState(documentedLocation)
  useEffect(() => {
    api.get('/cabinet/location/')
      .then((response) => setLocation(response.data || documentedLocation))
      .catch(() => setLocation(documentedLocation))
  }, [])
  return (
    <InfoPageLayout
      eyebrow="Capstone Project"
      title="About TapTrack"
      description="An NFC-enabled cabinet management system that connects physical cabinet access with secure, role-based web monitoring."
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
          <p>TapTrack is an NFC-enabled cabinet management system developed to improve the security, organization, accessibility, and monitoring of laboratory equipment through digital identification and web-based management.</p>
          <p>TapTrack is a capstone project for managing access to laboratory equipment using NFC-enabled identification cards, Raspberry Pi hardware, and a centralized monitoring platform.</p>
        </div>
      </section>

      <section className="border-b border-[#cbd8e6] py-8">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[#082B53]"><MapPin size={21} aria-hidden="true" />Where to Find TapTrack</h2>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-[#526780]">The TapTrack cabinet is designed for installation along the hallway near the College of Information Technology and Computing (CITC) Office at the University of Science and Technology of Southern Philippines (USTP). The cabinet provides an organized location for storing and accessing laboratory equipment used during academic activities.</p>
        <dl className="mt-5 grid gap-3 rounded-lg border border-[#dbe5f0] bg-[#F8FAFC] p-5 sm:grid-cols-2">
          {[['Institution', location.institution_name], ['College', location.college_name], ['Building', location.building_name], ['Designated Cabinet Location', location.location_description], ['Purpose', location.purpose]].map(([label, value]) => (
            <div key={label} className="rounded-md border border-[#dbe5f0] bg-white p-4"><dt className="text-xs font-bold uppercase text-[#526780]">{label}</dt><dd className="mt-1 font-semibold text-[#082B53]">{value}</dd></div>
          ))}
        </dl>
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
          <ul className="mt-4 space-y-2 text-sm text-[#28415f]">
            <li><span className="font-semibold">Project team:</span></li>
            <li>Ramiro, Christian Joseph F.</li>
            <li>Avenido, Earl Louie O.</li>
            <li>Bagares, Kurt P.</li>
            <li>Bulanon, Shelly Marie S.</li>
            <li>Paderanga, Ryan Ulrich E.</li>
            <li><span className="font-semibold">Capstone Adviser:</span> Engr. Jay Noel Rojo</li>
            <li><span className="font-semibold">Department / Institution:</span> College of Information Technology and Computing (CITC), University of Science and Technology of Southern Philippines (USTP).</li>
          </ul>
        </div>
      </section>
    </InfoPageLayout>
  )
}