import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function HomePage() {
  const navigate = useNavigate()
  const [joinName, setJoinName] = useState('')
  const [joinCode, setJoinCode] = useState('')

  function joinRoom(isSpectator: boolean) {
    if (!joinName.trim() || !joinCode.trim()) return
    const roomId = joinCode.trim().toUpperCase()
    sessionStorage.setItem(`pp:name:${roomId}`, joinName.trim())
    sessionStorage.setItem(`pp:spectator:${roomId}`, String(isSpectator))
    navigate(`/room/${roomId}`)
  }

  return (
    <section className="home">
      <h1>Planning Poker</h1>

      <div className="home__panel home__panel--join">
        <h2>Join a room</h2>
        <input
          placeholder="Your name"
          maxLength={12}
          value={joinName}
          onChange={(e) => setJoinName(e.target.value)}
        />
        <input
          placeholder="Room code"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
        />
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
