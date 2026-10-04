const sizeClasses = {
  medium: 'min-h-11 px-4 py-2 text-sm',
  small: 'min-h-9 px-3 py-1.5 text-xs',
  icon: 'h-10 w-10 p-0',
}

export default function Button({
  variant = 'secondary',
  size = 'medium',
  icon: Icon,
  children,
  className = '',
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={`tt-button tt-button-${variant} ${sizeClasses[size] || sizeClasses.medium} ${className}`.trim()}
      {...props}
    >
      {Icon && <Icon size={size === 'small' ? 14 : 16} aria-hidden="true" />}
      {children}
    </button>
  )
}