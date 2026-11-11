type Props = { message: string; onRetry?: () => void }

export function CardError({ message, onRetry }: Props) {
  return (
    <div className="card-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="retry-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
