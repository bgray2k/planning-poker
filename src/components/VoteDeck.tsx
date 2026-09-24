import type { CardValue } from "../../shared/protocol.ts";

interface VoteDeckProps {
  readonly values: readonly CardValue[];
  readonly selected: CardValue | null;
  readonly disabled: boolean;
  readonly onVote: (value: CardValue) => void;
}

export function VoteDeck({
  values,
  selected,
  disabled,
  onVote,
}: VoteDeckProps) {
  return (
    <div className="vote-deck">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={`card${selected === value ? " card--selected" : ""}`}
          disabled={disabled}
          onClick={() => onVote(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
