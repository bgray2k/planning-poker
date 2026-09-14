import { useState } from 'react'
import { SquareArrowRightExit, Eye, UserRound } from 'lucide-react'
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
        <h1>Join room {roomId}</h1>
        <input
          placeholder="Your name"
          maxLength={12}
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
        />
        <div className="join__actions">
          <button type="button" onClick={() => joinRoom(false)}>
            Join
          </button>
          <button type="button" onClick={() => joinRoom(true)}>
            Join as spectator
          </button>
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
    if (window.confirm('End this session for everyone?')) endSession()
  }

  return (
    <section className="room">
      {notification && (
        <div className="room__notification" role="status" aria-live="polite">
          {notification}
        </div>
      )}
      <header className="room__header">
        <div className="room__title">
          <h1>Room {state.roomId}</h1>
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
        onMakeFacilitator={makeFacilitator}
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
