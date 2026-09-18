import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const ALLOWED_ROOM_IDS = new Set(['NOVA', 'HORIZON'])
const ROOM_NOT_FOUND_MESSAGE = 'Room does not exist'

export function HomePage() {
  const navigate = useNavigate()
  const [joinName, setJoinName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [notification, setNotification] = useState<string | null>(null)

  useEffect(() => {
    if (!notification) return
    const timeout = window.setTimeout(() => setNotification(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [notification])

  function joinRoom(isSpectator: boolean) {
    if (!joinName.trim() || !joinCode.trim()) return
    const roomId = joinCode.trim().toUpperCase()
    if (!ALLOWED_ROOM_IDS.has(roomId)) {
      setNotification(ROOM_NOT_FOUND_MESSAGE)
      return
    }
    setNotification(null)
    sessionStorage.setItem(`pp:name:${roomId}`, joinName.trim())
    sessionStorage.setItem(`pp:spectator:${roomId}`, String(isSpectator))
    navigate(`/room/${roomId}`)
  }

  return (
    <section className="home">
      {notification && (
        <div className="home__notification" role="status" aria-live="polite">
          {notification}
        </div>
      )}
      <h1 style={{ padding: '10px' }}>Planning Poker</h1>

      <div className="home__panel home__panel--join">
        <h2>Join a room</h2>
        <input
          placeholder="Your name"
          maxLength={12}
          value={joinName}
          onChange={(e) => setJoinName(e.target.value)}
        />
        <div className="room-code-field">
          <label htmlFor="room-code">Room code</label>
          <span
            className="room-code-field__tip"
            title="Room codes are pre-defined. Please reach out to the developer for an approved room code."
            tabIndex={0}
            aria-label="Room codes are pre-defined. Please reach out to the developer for an approved room code."
          >
            <Info aria-hidden="true" size={16} />
          </span>
          <input
            id="room-code"
            placeholder="Room code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
        </div>
        <div className="home__actions">
          <button type="button" onClick={() => joinRoom(false)}>
            Join room
          </button>
          <button type="button" onClick={() => joinRoom(true)}>
            Join as spectator
          </button>
        </div>
      </div>
    </section>
  )
}
