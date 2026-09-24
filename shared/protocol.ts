// Message protocol shared between the frontend and the realtime room server.
// Keeping this identical to what the future Cloudflare Durable Object will speak
// means swapping the transport later doesn't require changing this contract.

export const VOTE_DECKS = {
  storyPoints: ['1', '2', '3', '5', '8', '?'],
  timebox: ['0.5','1', '1.5', '2', '2.5', '3', '?'],
  tShirt: ['XS', 'S', 'M', 'L', 'XL', '?'],
  confidence: ['1', '2', '3', '4', '5', '?'],
} as const

export const ROOM_IDS = ['NOVA', 'HORIZON', 'SHOGUN'] as const

export type RoomId = (typeof ROOM_IDS)[number]

export function isRoomId(value: string): value is RoomId {
  return ROOM_IDS.includes(value as RoomId)
}

export const MAX_PARTICIPANTS = 20
export const REACTION_EMOJIS = ['🧻', '✏️', '🚩', '✈️', '🚌'] as const
export const REACTION_COUNTS = [1, 2, 3] as const
export const REACTION_SPEEDS = [1, 2] as const
export const AFK_TIMEOUT_MS = 60 * 60 * 1000
export const AFK_CHECK_INTERVAL_MS = 5 * 60 * 1000
export const AFK_TIMEOUT_MESSAGE = 'You were disconnected for inactivity.'
export const END_SESSION_MESSAGE = 'This session has ended.'
export const KICKED_MESSAGE = 'You were removed from this session.'

export type VoteDeckType = keyof typeof VOTE_DECKS
export type CardValue = (typeof VOTE_DECKS)[VoteDeckType][number]
export type ReactionCount = (typeof REACTION_COUNTS)[number]
export type ReactionSpeed = (typeof REACTION_SPEEDS)[number]

export interface ParticipantView {
  id: string
  name: string
  isFacilitator: boolean
  isSpectator: boolean
  hasVoted: boolean
  // Only populated for the viewer's own vote, or for everyone once revealed.
  vote: CardValue | null
}

export interface RoomStateView {
  roomId: string
  revealed: boolean
  deckType: VoteDeckType
  participants: ParticipantView[]
  you: { id: string; isFacilitator: boolean; isSpectator: boolean }
}

export type ClientMessage =
  | { type: 'join'; name: string; isSpectator: boolean; clientId: string }
  | { type: 'vote'; value: CardValue }
  | { type: 'setDeck'; deckType: VoteDeckType }
  | { type: 'setSpectator'; isSpectator: boolean }
  | { type: 'reveal' }
  | { type: 'reset' }
  | { type: 'makeFacilitator'; participantId: string }
  | { type: 'kickParticipant'; participantId: string }
  | { type: 'claimFacilitator' }
  | { type: 'endSession' }
  | { type: 'throwEmoji'; targetId: string; emoji: string; count?: ReactionCount; speed?: ReactionSpeed }

export type ServerMessage =
  | { type: 'state'; state: RoomStateView }
  | { type: 'error'; message: string }
  | { type: 'hostTransferred'; actorName: string; targetName: string }
  | {
      type: 'emojiThrown'
      id: string
      targetId: string
      emoji: string
      from: 'left' | 'right'
      startY: number
      impactY?: number
      speed: ReactionSpeed
    }
