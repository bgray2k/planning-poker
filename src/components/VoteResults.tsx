import { useMemo } from "react";
import type { CardValue, ParticipantView } from "../../shared/protocol.ts";

interface VoteResultsProps {
  readonly values: readonly CardValue[];
  readonly participants: ParticipantView[];
}

export function VoteResults({ values, participants }: VoteResultsProps) {
  const counts = useMemo(() => {
    const map = new Map<CardValue, number>();
    for (const p of participants) {
      if (p.vote) map.set(p.vote, (map.get(p.vote) ?? 0) + 1);
    }
    return map;
  }, [participants]);

  const maxCount = Math.max(1, ...counts.values());

  const average = useMemo(() => {
    const numericVotes = participants
      .map((p) => (p.vote ? Number(p.vote) : Number.NaN))
      .filter((n) => !Number.isNaN(n));
    if (numericVotes.length === 0) return null;
    return numericVotes.reduce((sum, n) => sum + n, 0) / numericVotes.length;
  }, [participants]);

  return (
    <div className="vote-results">
      <div className="vote-results__bars">
        {values.map((value) => {
          const count = counts.get(value) ?? 0;
          const barHeight = (count / maxCount) * 100;
          return (
            <div key={value} className="vote-results__bar-group">
              <div className="vote-results__track">
                <div
                  className="vote-results__bar"
                  style={{ height: `${barHeight}%` }}
                >
                  {count > 0 && (
                    <span className="vote-results__count">{count}</span>
                  )}
                </div>
              </div>
              <span className="vote-results__label">{value}</span>
            </div>
          );
        })}
      </div>
      {average !== null && (
        <p className="vote-results__average">
          Average: <strong>{average.toFixed(1)}</strong>
        </p>
      )}
    </div>
  );
}
