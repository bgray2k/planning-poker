import { useState } from 'react'
import { Eye, LogIn, SquareArrowRightExit, UserRound, UsersRound } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { PokerTable } from '../components/PokerTable.tsx'
import { RevealControls } from '../components/RevealControls.tsx'
import { ShareLink } from '../components/ShareLink.tsx'
import { VoteDeck } from '../components/VoteDeck.tsx'
import { VoteResults } from '../components/VoteResults.tsx'
import { useRoomConnection } from '../hooks/useRoomConnection.ts'
import { VOTE_DECKS, type VoteDeckType } from '../../shared/protocol.ts'

const deckOptions: { label: string; value: VoteDeckType }[] = [
  { label: 'Story points', value: 'storyPoints' },
  { label: 'Timebox', value: 'timebox' },
  { label: 'T-Shirt', value: 'tShirt' },
  { label: 'Confidence', value: 'confidence' },
]

export function RoomPage() {
  const { roomId = '' } = useParams()
  const [name, setName] = useState(() => sessionStorage.getItem(`pp:name:${roomId}`))
  const [isSpectator, setIsSpectator] = useState(
    () => sessionStorage.getItem(`pp:spectator:${roomId}`) === 'true',
  )
  const [nameInput, setNameInput] = useState('')
  const [showEndSessionDialog, setShowEndSessionDialog] = useState(false)
  const [participantConfirmation, setParticipantConfirmation] = useState<{
    id: string
    name: string
    action: 'host' | 'kick'
  } | null>(null)

  const {
    state,
    connected,
    error,
    notification,
    reactions,
    vote,
    setDeck,
    setSpectator,
    reveal,
    reset,
    endSession,
    makeFacilitator,
    kickParticipant,
    throwEmoji,
  } =
    useRoomConnection(roomId, name, isSpectator)

  function joinRoom(spectator: boolean) {
    if (!nameInput.trim()) return
    sessionStorage.setItem(`pp:name:${roomId}`, nameInput.trim())
    sessionStorage.setItem(`pp:spectator:${roomId}`, String(spectator))
    setIsSpectator(spectator)
    setName(nameInput.trim())
  }

  if (!name) {
    return (
      <section className="join">
        <span className="room-badge">ROOM / {roomId}</span>
        <div className="join__panel">
          <input
            id="join-name"
            placeholder="Your name"
            maxLength={12}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <div className="join__actions">
            <button type="button" onClick={() => joinRoom(false)}>
              <LogIn aria-hidden="true" size={17} />
              Join
            </button>
            <button type="button" onClick={() => joinRoom(true)}>
              <Eye aria-hidden="true" size={17} />
              Join as spectator
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (error) return <p className="error">{error}</p>
  if (!connected || !state) return <p>Connecting…</p>

  const you = state.participants.find((p) => p.id === state.you.id)
  const players = state.participants.filter((participant) => !participant.isSpectator)
  const hasVotes = players.some((participant) => participant.hasVoted)

  function toggleSpectator(currentIsSpectator: boolean) {
    const nextIsSpectator = !currentIsSpectator
    sessionStorage.setItem(`pp:spectator:${roomId}`, String(nextIsSpectator))
    setSpectator(nextIsSpectator)
  }

  function confirmEndSession() {
    setShowEndSessionDialog(true)
  }

  function endRoomSession() {
    setShowEndSessionDialog(false)
    endSession()
  }

  function confirmKickParticipant(participantId: string) {
    const participant = state?.participants.find(({ id }) => id === participantId)
    if (participant) setParticipantConfirmation({ id: participant.id, name: participant.name, action: 'kick' })
  }

  function confirmMakeFacilitator(participantId: string) {
    const participant = state?.participants.find(({ id }) => id === participantId)
    if (participant) setParticipantConfirmation({ id: participant.id, name: participant.name, action: 'host' })
  }

  function confirmParticipantAction() {
    if (!participantConfirmation) return
    if (participantConfirmation.action === 'host') makeFacilitator(participantConfirmation.id)
    else kickParticipant(participantConfirmation.id)
    setParticipantConfirmation(null)
  }

  return (
    <section className="room">
      {showEndSessionDialog && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="end-session-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-session-title"
            aria-describedby="end-session-description"
          >
            <div className="end-session-dialog__accent" aria-hidden="true" />
            <h2 id="end-session-title">End this session?</h2>
            <p id="end-session-description">
              Everyone in the room will be disconnected.
            </p>
            <div className="end-session-dialog__actions">
              <button type="button" onClick={() => setShowEndSessionDialog(false)}>
                Cancel
              </button>
              <button type="button" className="end-session-dialog__confirm" onClick={endRoomSession}>
                End session
              </button>
            </div>
          </div>
        </div>
      )}
      {participantConfirmation && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="end-session-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="participant-action-title"
            aria-describedby="participant-action-description"
          >
            <div className="end-session-dialog__accent" aria-hidden="true" />
            <h2 id="participant-action-title">
              {participantConfirmation.action === 'host'
                ? `Are you sure you want to make ${participantConfirmation.name} host?`
                : `Are you sure you want to kick ${participantConfirmation.name}?`}
            </h2>
            <p id="participant-action-description">
              {participantConfirmation.action === 'host'
                ? 'You will no longer be the host.'
                : 'They will be disconnected from this session.'}
            </p>
            <div className="end-session-dialog__actions">
              <button type="button" onClick={() => setParticipantConfirmation(null)}>
                Cancel
              </button>
              <button type="button" className="end-session-dialog__confirm" onClick={confirmParticipantAction}>
                {participantConfirmation.action === 'host' ? 'Make host' : 'Kick player'}
              </button>
            </div>
          </div>
        </div>
      )}
      {notification && (
        <div className="room__notification" role="status" aria-live="polite">
          {notification}
        </div>
      )}
      <header className="room__header">
        <div className="room__title">
          <h1>Room {state.roomId}</h1>
          <span className="room-count" aria-label={`${state.participants.length} people in the room`}>
            <UsersRound aria-hidden="true" size={15} />
            <span>{state.participants.length}</span>
          </span>
          <ShareLink roomId={state.roomId} />
          <button
            type="button"
            className="role-toggle"
            onClick={() => toggleSpectator(state.you.isSpectator)}
            aria-label={state.you.isSpectator ? 'Play' : 'Spectate'}
            title={state.you.isSpectator ? 'Play' : 'Spectate'}
          >
            {state.you.isSpectator ? (
              <UserRound aria-hidden="true" size={16} />
            ) : (
              <Eye aria-hidden="true" size={16} />
            )}
          </button>
          {state.you.isFacilitator && (
            <button
              type="button"
              className="role-toggle"
              onClick={confirmEndSession}
              aria-label="End session"
              title="End session"
            >
              <SquareArrowRightExit aria-hidden="true" size={16} />
            </button>
          )}
        </div>
        <div className="vote-deck-selector" aria-label="Vote card set">
          {deckOptions.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              className={state.deckType === value ? 'vote-deck-selector__button--active' : ''}
              aria-pressed={state.deckType === value}
              disabled={!state.you.isFacilitator}
              onClick={() => setDeck(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <PokerTable
        participants={state.participants}
        revealed={state.revealed}
        reactions={reactions}
        canMakeFacilitator={state.you.isFacilitator}
        onMakeFacilitator={confirmMakeFacilitator}
        onKickParticipant={confirmKickParticipant}
        onThrowEmoji={throwEmoji}
        controls={
          <RevealControls
            isFacilitator={state.you.isFacilitator}
            revealed={state.revealed}
            hasVotes={hasVotes}
            onReveal={reveal}
            onReset={reset}
          />
        }
      />

      {state.revealed ? (
        <VoteResults values={VOTE_DECKS[state.deckType]} participants={state.participants} />
      ) : (
        !state.you.isSpectator && (
          <VoteDeck
            values={VOTE_DECKS[state.deckType]}
            selected={you?.vote ?? null}
            disabled={state.revealed}
            onVote={vote}
          />
        )
      )}
    </section>
  )
}
