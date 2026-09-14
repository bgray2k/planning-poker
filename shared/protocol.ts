// Message protocol shared between the frontend and the realtime room server.
// Keeping this identical to what the future Cloudflare Durable Object will speak
// means swapping the transport later doesn't require changing this contract.

export const VOTE_DECKS = {
  storyPoints: ['1', '2', '3', '5', '8', '?'],
  timebox: ['1', '1.5', '2', '2.5', '3', '?'],
  tShirt: ['XS', 'S', 'M', 'L', 'XL', '?'],
  confidence: ['1', '2', '3', '4', '5', '?'],
} as const

export const MAX_PARTICIPANTS = 20
export const REACTION_EMOJIS = ['🪨', '✏️', '🚩', '🛩️', '🚌'] as const
export const REACTION_COUNTS = [1, 3, 5] as const
export const AFK_TIMEOUT_MS = 60 * 60 * 1000
export const AFK_CHECK_INTERVAL_MS = 5 * 60 * 1000
export const AFK_TIMEOUT_MESSAGE = 'You were disconnected for inactivity.'
export const END_SESSION_MESSAGE = 'This session has ended.'

export type VoteDeckType = keyof typeof VOTE_DECKS
export type CardValue = (typeof VOTE_DECKS)[VoteDeckType][number]
export type ReactionCount = (typeof REACTION_COUNTS)[number]

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
  | { type: 'join'; name: string; isSpectator: boolean }
  | { type: 'vote'; value: CardValue }
  | { type: 'setDeck'; deckType: VoteDeckType }
  | { type: 'setSpectator'; isSpectator: boolean }
  | { type: 'reveal' }
  | { type: 'reset' }
  | { type: 'makeFacilitator'; participantId: string }
  | { type: 'claimFacilitator' }
  | { type: 'endSession' }
  | { type: 'throwEmoji'; targetId: string; emoji: string; count?: ReactionCount }

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
    }
