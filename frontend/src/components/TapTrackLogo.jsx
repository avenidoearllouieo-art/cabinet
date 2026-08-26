const WORDMARK_SRC = '/logo1.png'
const ICON_SRC = '/logo2.png'

export default function TapTrackLogo({ compact = false, responsive = false, mobileCompact = false, className = '' }) {
  if (responsive || mobileCompact) {
    return (
      <>
        <img
          src={WORDMARK_SRC}
          alt="TapTrack"
          className={`${compact ? 'hidden' : responsive || mobileCompact ? 'block max-sm:hidden' : 'block'} h-9 w-auto max-w-[180px] object-contain sm:h-10 ${className}`}
        />
        <img
          src={ICON_SRC}
          alt="TapTrack"
          className={`${compact ? 'block' : responsive || mobileCompact ? 'hidden max-sm:block' : 'hidden'} h-9 w-9 object-contain ${className}`}
        />
      </>
    )
  }

  return (
    <img
      src={compact ? ICON_SRC : WORDMARK_SRC}
      alt="TapTrack"
      className={`${compact ? 'h-10 w-10' : 'h-12 w-auto max-w-full'} object-contain ${className}`}
    />
  )
}
