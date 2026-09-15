import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const predefinedRoomIds = [
  'X5C7DC',
  'G4A3R7',
  'CCXBF6',
  '2QQ6YB',
  'DFJJTU',
  'Z4EN8Q',
  'B3MANX',
  'NXWD9K',
  '8H8VBB',
  'WX8TUT',
  'VXPJG7',
  'WNWJPQ',
  'W88D5V',
  '4P44J5',
  '3Z2S7D',
  '4QN6C3',
  'HJ2SEF',
  '4QDFBD',
  'B3M4U5',
  '5BEBW2',
]

export function HomePage() {
  const navigate = useNavigate()
  const [createName, setCreateName] = useState('')
  const [joinName, setJoinName] = useState('')
  const [joinCode, setJoinCode] = useState('')

  function createRoom(isSpectator: boolean) {
    if (!createName.trim()) return
    const roomId = predefinedRoomIds[Math.floor(Math.random() * predefinedRoomIds.length)]
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
