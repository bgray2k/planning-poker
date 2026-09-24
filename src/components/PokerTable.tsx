import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { EmojiStyle, Theme } from "emoji-picker-react";
import { Crown, Eye, FastForward, LogOut, Play, SmilePlus } from "lucide-react";
import {
  REACTION_COUNTS,
  REACTION_EMOJIS,
  type CardValue,
  type ParticipantView,
  type ReactionCount,
  type ReactionSpeed,
} from "../../shared/protocol.ts";
import type { EmojiReaction } from "../hooks/useRoomConnection.ts";

const EmojiPicker = lazy(() => import("emoji-picker-react"));
const Emoji = lazy(() =>
  import("emoji-picker-react").then(({ Emoji: EmojiComponent }) => ({
    default: EmojiComponent,
  })),
);
const APPLE_EMOJI_STYLE = "apple" as EmojiStyle;

interface PokerTableProps {
  readonly participants: ParticipantView[];
  readonly revealed: boolean;
  readonly reactions: EmojiReaction[];
  readonly canMakeFacilitator: boolean;
  readonly onMakeFacilitator: (participantId: string) => void;
  readonly onKickParticipant: (participantId: string) => void;
  readonly onThrowEmoji: (
    targetId: string,
    emoji: string,
    count: ReactionCount,
    speed: ReactionSpeed,
  ) => void;
  readonly controls: ReactNode;
}

function mostVotedValue(
  participants: ParticipantView[],
): CardValue | "split" | null {
  const counts = new Map<CardValue, number>();
  for (const p of participants) {
    if (p.vote) counts.set(p.vote, (counts.get(p.vote) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const bestCount = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(
    ([, count]) => count === bestCount,
  );
  return leaders.length > 1 ? "split" : leaders[0][0];
}

function reactionStyle(reaction: EmojiReaction): CSSProperties {
  const seed = [...reaction.id].reduce(
    (total, character) => total + (character.codePointAt(0) ?? 0),
    0,
  );
  return {
    "--reaction-impact-rotation": `${(seed % 51) - 25}deg`,
    "--reaction-spin-end": `${(seed % 360) + 180}deg`,
    "--reaction-start-y": `${reaction.startY}vh`,
    "--reaction-impact-y": `${reaction.impactY ?? 50}%`,
    "--reaction-duration": `${4.2 / (reaction.speed ?? 1)}s`,
  } as CSSProperties;
}

function displayPlayerName(name: string): string {
  return name === "Will" || name === "will" ? `${name} 🚌` : name;
}

function emojiToUnified(emoji: string): string {
  return [...emoji]
    .map((character) => (character.codePointAt(0) ?? 0).toString(16))
    .join("-");
}

interface SeatPosition {
  readonly className: string;
  readonly style: CSSProperties;
}

interface SeatEmojiPickerProps {
  readonly participant: ParticipantView;
  readonly reactionCount: ReactionCount;
  readonly reactionSpeed: ReactionSpeed;
  readonly isExpanded: boolean;
  readonly isVisible: boolean;
  readonly canMakeFacilitator: boolean;
  readonly onMakeFacilitator: (participantId: string) => void;
  readonly onKickParticipant: (participantId: string) => void;
  readonly onThrowEmoji: (
    targetId: string,
    emoji: string,
    count: ReactionCount,
    speed: ReactionSpeed,
  ) => void;
  readonly onSelectReactionCount: (count: ReactionCount) => void;
  readonly onSelectReactionSpeed: (speed: ReactionSpeed) => void;
  readonly onExpand: () => void;
}

interface PlayerSeatProps {
  readonly participant: ParticipantView;
  readonly reactionCount: ReactionCount;
  readonly reactionSpeed: ReactionSpeed;
  readonly position: SeatPosition;
  readonly revealed: boolean;
  readonly majorityVote: CardValue | null;
  readonly reactions: EmojiReaction[];
  readonly quickPickerTargetId: string | null;
  readonly emojiPickerTargetId: string | null;
  readonly canMakeFacilitator: boolean;
  readonly onMakeFacilitator: (participantId: string) => void;
  readonly onKickParticipant: (participantId: string) => void;
  readonly onOpenQuickPicker: (targetId: string) => void;
  readonly onOpenExpandedPicker: (targetId: string) => void;
  readonly onThrowEmoji: (
    targetId: string,
    emoji: string,
    count: ReactionCount,
    speed: ReactionSpeed,
  ) => void;
  readonly onSelectReactionCount: (count: ReactionCount) => void;
  readonly onSelectReactionSpeed: (speed: ReactionSpeed) => void;
}

function renderSeatCardContent(
  participant: ParticipantView,
  revealed: boolean,
): ReactNode {
  if (participant.isSpectator) {
    return (
      <span
        className="seat__spectator"
        role="img"
        aria-label={`${participant.name} is spectating`}
      >
        <Eye aria-hidden="true" size={18} />
      </span>
    );
  }

  if (!participant.hasVoted) {
    if (!revealed) {
      return (
        <output
          className="seat__spinner"
          aria-label={`${participant.name} has not voted`}
        />
      );
    }

    return (
      <span role="img" aria-label={`${participant.name} did not vote`}>
        🤡
      </span>
    );
  }

  return participant.vote ?? "✓";
}

function handleSeatCardKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  activate: () => void,
) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function ReactionCountControls({
  selectedCount,
  onSelect,
}: {
  readonly selectedCount: ReactionCount;
  readonly onSelect: (count: ReactionCount) => void;
}) {
  return (
    <div
      className="seat__reaction-counts"
      role="group"
      aria-label="Emoji count"
    >
      {REACTION_COUNTS.map((count) => (
        <button
          key={count}
          type="button"
          className="seat__reaction-count"
          aria-label={`Send ${count} emojis`}
          aria-pressed={selectedCount === count}
          onClick={() => onSelect(count)}
        >
          x{count}
        </button>
      ))}
    </div>
  );
}

function ReactionSpeedControls({
  selectedSpeed,
  onSelect,
}: {
  readonly selectedSpeed: ReactionSpeed;
  readonly onSelect: (speed: ReactionSpeed) => void;
}) {
  return (
    <div
      className="seat__reaction-speeds"
      role="group"
      aria-label="Emoji speed"
    >
      <button
        type="button"
        className="seat__reaction-speed"
        aria-label="Normal emoji speed"
        aria-pressed={selectedSpeed === 1}
        onClick={() => onSelect(1)}
      >
        <Play aria-hidden="true" size={14} />
      </button>
      <button
        type="button"
        className="seat__reaction-speed"
        aria-label="Double emoji speed"
        aria-pressed={selectedSpeed === 2}
        onClick={() => onSelect(2)}
      >
        <FastForward aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

function SeatEmojiPicker({
  participant,
  reactionCount,
  reactionSpeed,
  isExpanded,
  isVisible,
  canMakeFacilitator,
  onMakeFacilitator,
  onKickParticipant,
  onThrowEmoji,
  onSelectReactionCount,
  onSelectReactionSpeed,
  onExpand,
}: SeatEmojiPickerProps) {
  return (
    <div
      className={`seat__picker-stack${isVisible || isExpanded ? " seat__picker-stack--visible" : ""}`}
    >
      <div
        className={`seat__emoji-picker${isVisible ? " seat__emoji-picker--visible" : ""}${isExpanded ? " seat__emoji-picker--expanded" : ""}`}
        aria-label={`Send a reaction to ${participant.name}`}
      >
        {isVisible && canMakeFacilitator && (
          <div className="seat__make-host-row">
            {!participant.isFacilitator && (
              <button
                type="button"
                className="seat__make-host"
                aria-label={`Make ${participant.name} host`}
                title={`Make ${participant.name} host`}
                onClick={() => onMakeFacilitator(participant.id)}
              >
                <Crown aria-hidden="true" size={15} />
              </button>
            )}
            <button
              type="button"
              className="seat__kick-player"
              aria-label={`Kick ${participant.name}`}
              title={`Kick ${participant.name}`}
              onClick={() => onKickParticipant(participant.id)}
            >
              <LogOut aria-hidden="true" size={15} />
            </button>
          </div>
        )}
        {isExpanded ? (
          <Suspense fallback={null}>
            <EmojiPicker
              onEmojiClick={(emojiData) => {
                onThrowEmoji(
                  participant.id,
                  emojiData.emoji,
                  reactionCount,
                  reactionSpeed,
                );
              }}
              theme={"dark" as Theme}
              width={260}
              height={320}
              previewConfig={{ showPreview: false }}
            />
            <ReactionCountControls
              selectedCount={reactionCount}
              onSelect={onSelectReactionCount}
            />
            <ReactionSpeedControls
              selectedSpeed={reactionSpeed}
              onSelect={onSelectReactionSpeed}
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
                onClick={() =>
                  onThrowEmoji(
                    participant.id,
                    emoji,
                    reactionCount,
                    reactionSpeed,
                  )
                }
              >
                <Suspense fallback={emoji}>
                  <Emoji
                    unified={emojiToUnified(emoji)}
                    emojiStyle={APPLE_EMOJI_STYLE}
                    size={22}
                  />
                </Suspense>
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
            <ReactionCountControls
              selectedCount={reactionCount}
              onSelect={onSelectReactionCount}
            />
            <ReactionSpeedControls
              selectedSpeed={reactionSpeed}
              onSelect={onSelectReactionSpeed}
            />
          </>
        )}
      </div>
    </div>
  );
}

function PlayerSeat({
  participant,
  reactionCount,
  reactionSpeed,
  position,
  revealed,
  majorityVote,
  reactions,
  quickPickerTargetId,
  emojiPickerTargetId,
  canMakeFacilitator,
  onMakeFacilitator,
  onKickParticipant,
  onOpenQuickPicker,
  onOpenExpandedPicker,
  onThrowEmoji,
  onSelectReactionCount,
  onSelectReactionSpeed,
}: PlayerSeatProps) {
  const playerReactions = reactions.filter(
    (reaction) => reaction.targetId === participant.id,
  );
  const isQuickPickerVisible = quickPickerTargetId === participant.id;
  const isExpandedPickerVisible = emojiPickerTargetId === participant.id;
  const isPickerOpen = isQuickPickerVisible || isExpandedPickerVisible;
  const keepsVotedStyle =
    participant.hasVoted && (!revealed || participant.vote === majorityVote);
  const openQuickPicker = () => onOpenQuickPicker(participant.id);

  return (
    <div
      className={`seat ${position.className}${isPickerOpen ? " seat--emoji-picker-open" : ""}`}
      style={position.style}
    >
      {participant.isFacilitator && (
        <span
          className="seat__host-crown"
          role="img"
          aria-label={`${participant.name} is the host`}
        >
          👑
        </span>
      )}
      <div className="seat__card-wrapper">
        <button
          type="button"
          className={`seat__card${keepsVotedStyle ? " seat__card--voted" : ""}`}
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
              <Suspense fallback={reaction.emoji}>
                <Emoji
                  unified={emojiToUnified(reaction.emoji)}
                  emojiStyle={APPLE_EMOJI_STYLE}
                  size={22}
                />
              </Suspense>
            </span>
          ))}
        </button>
        <SeatEmojiPicker
          participant={participant}
          reactionCount={reactionCount}
          reactionSpeed={reactionSpeed}
          isExpanded={isExpandedPickerVisible}
          isVisible={isQuickPickerVisible}
          canMakeFacilitator={canMakeFacilitator}
          onMakeFacilitator={onMakeFacilitator}
          onKickParticipant={onKickParticipant}
          onThrowEmoji={onThrowEmoji}
          onSelectReactionCount={onSelectReactionCount}
          onSelectReactionSpeed={onSelectReactionSpeed}
          onExpand={() => onOpenExpandedPicker(participant.id)}
        />
      </div>
      <span className="seat__name">{displayPlayerName(participant.name)}</span>
    </div>
  );
}

export function PokerTable({
  participants,
  revealed,
  reactions,
  canMakeFacilitator,
  onMakeFacilitator,
  onKickParticipant,
  onThrowEmoji,
  controls,
}: PokerTableProps) {
  const [reactionCount, setReactionCount] = useState<ReactionCount>(1);
  const [reactionSpeed, setReactionSpeed] = useState<ReactionSpeed>(1);
  const [quickPickerTargetId, setQuickPickerTargetId] = useState<string | null>(
    null,
  );
  const [emojiPickerTargetId, setEmojiPickerTargetId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!quickPickerTargetId && !emojiPickerTargetId) return;

    const dismissPickers = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(".seat__picker-stack")
      ) {
        setQuickPickerTargetId(null);
        setEmojiPickerTargetId(null);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuickPickerTargetId(null);
        setEmojiPickerTargetId(null);
      }
    };

    document.addEventListener("pointerdown", dismissPickers);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissPickers);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [emojiPickerTargetId, quickPickerTargetId]);

  const result = useMemo(
    () => (revealed ? mostVotedValue(participants) : null),
    [participants, revealed],
  );
  const majorityVote = result === "split" ? null : result;
  let resultLabel: ReactNode = null;
  if (result === "split") {
    resultLabel = (
      <span className="poker-table__result-label">Room is split</span>
    );
  } else if (result) {
    resultLabel = <span className="poker-table__result-value">{result}</span>;
  } else if (revealed) {
    resultLabel = (
      <span className="poker-table__result-label">No votes yet</span>
    );
  }
  const tableWidth = Math.min(46, 27 + participants.length);
  const tableHeight = 29;
  const tableInset = (100 - tableWidth) / 2;
  const tableVerticalInset = (100 - tableHeight) / 2;
  const tableStyle = {
    "--table-width": `${tableWidth}%`,
    "--table-height": `${tableHeight}%`,
    "--table-inset": `${tableInset}%`,
    "--table-vertical-inset": `${tableVerticalInset}%`,
  } as CSSProperties;

  const topBottomCount = Math.min(
    participants.length,
    Math.ceil(participants.length * 0.8),
  );
  const edgeGroups = [
    { edge: "top", count: Math.ceil(topBottomCount / 2) },
    {
      edge: "right",
      count: Math.ceil((participants.length - topBottomCount) / 2),
    },
    { edge: "bottom", count: Math.floor(topBottomCount / 2) },
    {
      edge: "left",
      count: Math.floor((participants.length - topBottomCount) / 2),
    },
  ];
  const seatAssignments = edgeGroups.flatMap(({ edge, count }) =>
    Array.from({ length: count }, (_, seatIndex) => ({
      edge,
      count,
      seatIndex,
    })),
  );

  const seatPositions: SeatPosition[] = participants.map((_, index) => {
    const assignment = seatAssignments[index];
    let position = 0.5;
    if (assignment.count > 1) {
      const isTwoSeatShortEdge =
        assignment.count === 2 &&
        (assignment.edge === "right" || assignment.edge === "left");
      const edgeStart = isTwoSeatShortEdge ? 0.25 : 0.1;
      const edgeRange = isTwoSeatShortEdge ? 0.5 : 0.8;
      position =
        edgeStart + (assignment.seatIndex / (assignment.count - 1)) * edgeRange;
    }

    const horizontalPosition = tableInset + position * tableWidth;
    const verticalPosition = tableVerticalInset + position * tableHeight;

    if (assignment.edge === "top") {
      return {
        className: "seat--top",
        style: { left: `${horizontalPosition}%` },
      };
    }
    if (assignment.edge === "right") {
      return {
        className: "seat--right",
        style: { top: `${verticalPosition}%` },
      };
    }
    if (assignment.edge === "bottom") {
      return {
        className: "seat--bottom",
        style: { left: `${100 - horizontalPosition}%` },
      };
    }
    return {
      className: "seat--left",
      style: { top: `${100 - verticalPosition}%` },
    };
  });

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
          reactionCount={reactionCount}
          reactionSpeed={reactionSpeed}
          position={seatPositions[index]}
          revealed={revealed}
          majorityVote={majorityVote}
          reactions={reactions}
          quickPickerTargetId={quickPickerTargetId}
          emojiPickerTargetId={emojiPickerTargetId}
          canMakeFacilitator={canMakeFacilitator}
          onMakeFacilitator={onMakeFacilitator}
          onKickParticipant={onKickParticipant}
          onOpenQuickPicker={setQuickPickerTargetId}
          onOpenExpandedPicker={setEmojiPickerTargetId}
          onThrowEmoji={onThrowEmoji}
          onSelectReactionCount={setReactionCount}
          onSelectReactionSpeed={setReactionSpeed}
        />
      ))}
    </div>
  );
}
