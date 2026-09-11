interface RevealControlsProps {
  readonly isFacilitator: boolean
  readonly revealed: boolean
  readonly hasVotes: boolean
  readonly onReveal: () => void
  readonly onReset: () => void
}

export function RevealControls({
  isFacilitator,
  revealed,
  hasVotes,
  onReveal,
  onReset,
}: RevealControlsProps) {
  if (!isFacilitator) return null

  return (
    <div className="reveal-controls">
      {revealed ? (
        <button type="button" onClick={onReset}>
          Reset round
        </button>
      ) : (
        <button type="button" onClick={onReveal} disabled={!hasVotes}>
          Reveal votes
        </button>
      )}
    </div>
  )
}
