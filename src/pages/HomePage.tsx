import { customAlphabet } from 'nanoid'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const generateRoomId = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 6)

export function HomePage() {
  const navigate = useNavigate()
  const [createName, setCreateName] = useState('')
  const [joinName, setJoinName] = useState('')
  const [joinCode, setJoinCode] = useState('')

  function createRoom(isSpectator: boolean) {
    if (!createName.trim()) return
    const roomId = generateRoomId()
    sessionStorage.setItem(`pp:name:${roomId}`, createName.trim())
    sessionStorage.setItem(`pp:spectator:${roomId}`, String(isSpectator))
    navigate(`/room/${roomId}`)
  }

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

      <div className="home__panel">
        <h2>Create a room</h2>
        <input
          placeholder="Your name"
          maxLength={12}
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
        />
        <div className="home__actions">
          <button type="button" onClick={() => createRoom(false)}>
            Create room
          </button>
          <button type="button" onClick={() => createRoom(true)}>
            Create as spectator
          </button>
        </div>
      </div>

      <div className="home__panel">
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
