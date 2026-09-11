import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import type { Theme } from 'emoji-picker-react'
import { Eye, SmilePlus } from 'lucide-react'
import { REACTION_EMOJIS, type CardValue, type ParticipantView } from '../../shared/protocol.ts'
import type { EmojiReaction } from '../hooks/useRoomConnection.ts'

const EmojiPicker = lazy(() => import('emoji-picker-react'))

interface PokerTableProps {
  readonly participants: ParticipantView[]
  readonly revealed: boolean
  readonly reactions: EmojiReaction[]
  readonly onThrowEmoji: (targetId: string, emoji: string) => void
  readonly controls: ReactNode
}

function mostVotedValue(participants: ParticipantView[]): CardValue | 'split' | null {
  const counts = new Map<CardValue, number>()
  for (const p of participants) {
    if (p.vote) counts.set(p.vote, (counts.get(p.vote) ?? 0) + 1)
  }
  if (counts.size === 0) return null

  const bestCount = Math.max(...counts.values())
  const leaders = [...counts.entries()].filter(([, count]) => count === bestCount)
  return leaders.length > 1 ? 'split' : leaders[0][0]
}

function reactionStyle(reaction: EmojiReaction): CSSProperties {
  const seed = [...reaction.id].reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0)
  return {
    '--reaction-impact-rotation': `${(seed % 51) - 25}deg`,
    '--reaction-spin-end': `${(seed % 360) + 180}deg`,
    '--reaction-start-y': `${reaction.startY}vh`,
  } as CSSProperties
}

interface SeatPosition {
  readonly className: string
  readonly style: CSSProperties
}

interface SeatEmojiPickerProps {
  readonly participant: ParticipantView
  readonly isExpanded: boolean
  readonly isVisible: boolean
  readonly onThrowEmoji: (targetId: string, emoji: string) => void
  readonly onExpand: () => void
}

interface PlayerSeatProps {
  readonly participant: ParticipantView
  readonly position: SeatPosition
  readonly revealed: boolean
  readonly majorityVote: CardValue | null
  readonly reactions: EmojiReaction[]
  readonly quickPickerTargetId: string | null
  readonly emojiPickerTargetId: string | null
  readonly onOpenQuickPicker: (targetId: string) => void
  readonly onOpenExpandedPicker: (targetId: string) => void
  readonly onThrowEmoji: (targetId: string, emoji: string) => void
}

function renderSeatCardContent(participant: ParticipantView, revealed: boolean): ReactNode {
  if (participant.isSpectator) {
    return (
      <span className="seat__spectator" role="img" aria-label={`${participant.name} is spectating`}>
        <Eye aria-hidden="true" size={18} />
      </span>
    )
  }

  if (!participant.hasVoted) {
    if (!revealed) {
      return <output className="seat__spinner" aria-label={`${participant.name} has not voted`} />
    }

    return (
      <span role="img" aria-label={`${participant.name} did not vote`}>
        🤡
      </span>
    )
  }

  return participant.vote ?? '✓'
}

function handleSeatCardKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, activate: () => void) {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  activate()
}

function SeatEmojiPicker({
  participant,
  isExpanded,
  isVisible,
  onThrowEmoji,
  onExpand,
}: SeatEmojiPickerProps) {
  return (
    <div
      className={`seat__emoji-picker${isVisible ? ' seat__emoji-picker--visible' : ''}${isExpanded ? ' seat__emoji-picker--expanded' : ''}`}
      aria-label={`Send a reaction to ${participant.name}`}
    >
      {isExpanded ? (
        <Suspense fallback={null}>
          <EmojiPicker
            onEmojiClick={(emojiData) => {
              onThrowEmoji(participant.id, emojiData.emoji)
            }}
            theme={'dark' as Theme}
            width={260}
            height={320}
            previewConfig={{ showPreview: false }}
          />
        </Suspense>
      ) : (
        <>
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="seat__emoji-button"
              aria-label={`Send ${emoji} to ${participant.name}`}
              onClick={() => onThrowEmoji(participant.id, emoji)}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            className="seat__emoji-button"
            aria-label={`Choose another reaction for ${participant.name}`}
            aria-expanded={isExpanded}
            onClick={onExpand}
          >
            <SmilePlus aria-hidden="true" size={17} />
          </button>
        </>
      )}
    </div>
  )
}

function PlayerSeat({
  participant,
  position,
  revealed,
  majorityVote,
  reactions,
  quickPickerTargetId,
  emojiPickerTargetId,
  onOpenQuickPicker,
  onOpenExpandedPicker,
  onThrowEmoji,
}: PlayerSeatProps) {
  const playerReactions = reactions.filter((reaction) => reaction.targetId === participant.id)
  const isQuickPickerVisible = quickPickerTargetId === participant.id
  const isExpandedPickerVisible = emojiPickerTargetId === participant.id
  const isPickerOpen = isQuickPickerVisible || isExpandedPickerVisible
  const keepsVotedStyle = participant.hasVoted && (!revealed || participant.vote === majorityVote)
  const openQuickPicker = () => onOpenQuickPicker(participant.id)

  return (
    <div
      className={`seat ${position.className}${isPickerOpen ? ' seat--emoji-picker-open' : ''}`}
      style={position.style}
    >
      {participant.isFacilitator && (
        <span className="seat__host-crown" role="img" aria-label={`${participant.name} is the host`}>
          👑
        </span>
      )}
      <div className="seat__card-wrapper">
        <button
          type="button"
          className={`seat__card${keepsVotedStyle ? ' seat__card--voted' : ''}`}
          aria-label={`Show reactions for ${participant.name}`}
          aria-expanded={isPickerOpen}
          onClick={openQuickPicker}
          onKeyDown={(event) => handleSeatCardKeyDown(event, openQuickPicker)}
        >
          {renderSeatCardContent(participant, revealed)}
          {playerReactions.map((reaction) => (
            <span
              key={reaction.id}
              className={`seat__reaction seat__reaction--from-${reaction.from}`}
              style={reactionStyle(reaction)}
              aria-hidden="true"
            >
              {reaction.emoji}
            </span>
          ))}
        </button>
        <SeatEmojiPicker
          participant={participant}
          isExpanded={isExpandedPickerVisible}
          isVisible={isQuickPickerVisible}
          onThrowEmoji={onThrowEmoji}
          onExpand={() => onOpenExpandedPicker(participant.id)}
        />
      </div>
      <span className="seat__name">{participant.name}</span>
    </div>
  )
}

export function PokerTable({ participants, revealed, reactions, onThrowEmoji, controls }: PokerTableProps) {
  const [quickPickerTargetId, setQuickPickerTargetId] = useState<string | null>(null)
  const [emojiPickerTargetId, setEmojiPickerTargetId] = useState<string | null>(null)

  useEffect(() => {
    if (!quickPickerTargetId && !emojiPickerTargetId) return

    const dismissPickers = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.seat__emoji-picker')) {
        setQuickPickerTargetId(null)
        setEmojiPickerTargetId(null)
      }
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setQuickPickerTargetId(null)
        setEmojiPickerTargetId(null)
      }
    }

    document.addEventListener('pointerdown', dismissPickers)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissPickers)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [emojiPickerTargetId, quickPickerTargetId])

  const result = useMemo(
    () => (revealed ? mostVotedValue(participants) : null),
    [participants, revealed],
  )
  const majorityVote = result === 'split' ? null : result
  let resultLabel: ReactNode = null
  if (result === 'split') {
    resultLabel = <span className="poker-table__result-label">Room is split</span>
  } else if (result) {
    resultLabel = <span className="poker-table__result-value">{result}</span>
  } else if (revealed) {
    resultLabel = <span className="poker-table__result-label">No votes yet</span>
  }
  const tableWidth = Math.min(46, 27 + participants.length)
  const tableHeight = 29
  const tableInset = (100 - tableWidth) / 2
  const tableVerticalInset = (100 - tableHeight) / 2
  const tableStyle = {
    '--table-width': `${tableWidth}%`,
    '--table-height': `${tableHeight}%`,
    '--table-inset': `${tableInset}%`,
    '--table-vertical-inset': `${tableVerticalInset}%`,
  } as CSSProperties

  const topBottomCount = Math.min(participants.length, Math.ceil(participants.length * 0.8))
  const edgeGroups = [
    { edge: 'top', count: Math.ceil(topBottomCount / 2) },
    { edge: 'right', count: Math.ceil((participants.length - topBottomCount) / 2) },
    { edge: 'bottom', count: Math.floor(topBottomCount / 2) },
    { edge: 'left', count: Math.floor((participants.length - topBottomCount) / 2) },
  ]
  const seatAssignments = edgeGroups.flatMap(({ edge, count }) =>
    Array.from({ length: count }, (_, seatIndex) => ({ edge, count, seatIndex })),
  )

  const seatPositions: SeatPosition[] = participants.map((_, index) => {
    const assignment = seatAssignments[index]
    let position = 0.5
    if (assignment.count > 1) {
      const isTwoSeatShortEdge =
        assignment.count === 2 && (assignment.edge === 'right' || assignment.edge === 'left')
      const edgeStart = isTwoSeatShortEdge ? 0.3 : 0.1
      const edgeRange = isTwoSeatShortEdge ? 0.4 : 0.8
      position = edgeStart + (assignment.seatIndex / (assignment.count - 1)) * edgeRange
    }

    const horizontalPosition = tableInset + position * tableWidth
    const verticalPosition = tableVerticalInset + position * tableHeight

    if (assignment.edge === 'top') {
      return { className: 'seat--top', style: { left: `${horizontalPosition}%` } }
    }
    if (assignment.edge === 'right') {
      return { className: 'seat--right', style: { top: `${verticalPosition}%` } }
    }
    if (assignment.edge === 'bottom') {
      return { className: 'seat--bottom', style: { left: `${100 - horizontalPosition}%` } }
    }
    return { className: 'seat--left', style: { top: `${100 - verticalPosition}%` } }
  })

  return (
    <div className="poker-table-wrapper" style={tableStyle}>
      <div className="poker-table">
        <div className="poker-table__center">
          {resultLabel}
          {controls}
        </div>
      </div>

      {participants.map((participant, index) => (
        <PlayerSeat
          key={participant.id}
          participant={participant}
          position={seatPositions[index]}
          revealed={revealed}
          majorityVote={majorityVote}
          reactions={reactions}
          quickPickerTargetId={quickPickerTargetId}
          emojiPickerTargetId={emojiPickerTargetId}
          onOpenQuickPicker={setQuickPickerTargetId}
          onOpenExpandedPicker={setEmojiPickerTargetId}
          onThrowEmoji={onThrowEmoji}
        />
      ))}
    </div>
  )
}
