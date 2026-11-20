import { useState } from 'react'

const sizeClasses = {
  xs: 'h-8 w-8 text-xs',
  sm: 'h-9 w-9 text-sm',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-24 w-24 text-3xl sm:h-28 sm:w-28',
}

function getUserInitials(user, fallbackInitials) {
  if (fallbackInitials) return fallbackInitials
  const firstName = String(user?.first_name || '').trim()
  const lastName = String(user?.last_name || '').trim()
  if (firstName || lastName) return `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase()
  const username = String(user?.username || '').trim()
  return username ? username[0].toUpperCase() : 'U'
}

function getImageSource(user, imageUrl) {
  const source = imageUrl ?? user?.profile_image_url ?? user?.profile_image ?? user?.avatar_url ?? user?.avatar
  return typeof source === 'string' && source.trim() ? source.trim() : null
}

export default function UserAvatar({
  user,
  imageUrl,
  initials,
  alt = '',
  size = 'md',
  shape = 'circle',
  className = '',
  imageClassName = '',
  fallbackClassName = '',
}) {
  const source = getImageSource(user, imageUrl)
  const imageKey = `${source || ''}:${user?.updated_at || ''}`
  const [failedImageKey, setFailedImageKey] = useState('')
  const showImage = source && failedImageKey !== imageKey
  const roundedClass = shape === 'square' ? 'rounded-md' : 'rounded-full'

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-[#e8f0f8] font-bold text-[#082B53] ${sizeClasses[size] || sizeClasses.md} ${roundedClass} ${className}`}>
      {showImage ? (
        <img
          key={imageKey}
          src={source}
          alt={alt}
          onError={() => setFailedImageKey(imageKey)}
          className={`h-full w-full object-cover ${imageClassName}`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className={`flex h-full w-full items-center justify-center ${fallbackClassName}`} aria-hidden={alt ? undefined : true}>
          {getUserInitials(user, initials)}
        </span>
      )}
    </span>
  )
}