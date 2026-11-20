import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import TapTrackLogo from './TapTrackLogo.jsx'

export default function InfoPageLayout({ eyebrow, title, description, children }) {
  return (
    <div className="min-h-screen bg-[#F3F6FA] text-[#102a4c]">
      <header className="bg-[#082B53] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="TapTrack home" className="inline-flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FFBE0B]">
            <TapTrackLogo className="h-9 max-w-[170px] object-contain" />
            <span className="sr-only">TapTrack</span>
          </Link>
          <Link to="/" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold text-white/90 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFBE0B]">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Back to Login</span>
          </Link>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto max-w-6xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
            <p className="text-xs font-bold uppercase text-[#FFBE0B]">{eyebrow}</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#EAF2FB] sm:text-base">{description}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">{children}</main>
      <footer className="border-t border-[#dbe5f0] bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-[#64748b] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>TapTrack · NFC-enabled cabinet and coursework management</span>
          <Link to="/" className="font-semibold text-[#082B53] hover:underline">Sign in to TapTrack</Link>
        </div>
      </footer>
    </div>
  )
}