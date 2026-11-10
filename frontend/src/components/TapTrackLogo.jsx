const WORDMARK_SRC = '/logo1-transparent.png'
const ICON_SRC = '/logo2-transparent.png'

export default function TapTrackLogo({ compact = false, responsive = false, mobileCompact = false, className = '' }) {
  if (responsive || mobileCompact) {
    return (
      <>
        <img
          src={WORDMARK_SRC}
          alt="TapTrack"
          className={`${compact ? 'hidden' : responsive || mobileCompact ? 'block max-[599.98px]:hidden' : 'block'} h-10 w-auto max-w-[200px] object-contain sm:h-12 ${className}`}
        />
        <img
          src={ICON_SRC}
          alt="TapTrack"
          className={`${compact ? 'block' : responsive || mobileCompact ? 'hidden max-[599.98px]:block' : 'hidden'} h-10 w-10 object-contain ${className}`}
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
