// Local dev realtime server for planning poker rooms.
// In-memory only; mirrors the message protocol the Cloudflare Durable Object will use later.
import { randomInt } from 'node:crypto'
import { createServer } from 'node:http'
import { nanoid } from 'nanoid'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  MAX_PARTICIPANTS,
  REACTION_COUNTS,
  VOTE_DECKS,
  type CardValue,
  type ClientMessage,
  type ParticipantView,
  type RoomStateView,
  type ServerMessage,
  type VoteDeckType,
} from '../shared/protocol.ts'

interface Participant {
  id: string
  name: string
  vote: CardValue | null
  isFacilitator: boolean
  isSpectator: boolean
  ws: WebSocket
  lastReactionAt: number
}

interface Room {
  id: string
  revealed: boolean
  deckType: VoteDeckType
  order: string[]
  participants: Map<string, Participant>
}

const rooms = new Map<string, Room>()
const connections = new WeakMap<WebSocket, { roomId: string; participantId: string }>()

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId)
  if (!room) {
    room = {
      id: roomId,
      revealed: false,
      deckType: 'storyPoints',
      order: [],
      participants: new Map(),
    }
    rooms.set(roomId, room)
  }
  return room
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

function buildStateFor(room: Room, viewerId: string): RoomStateView {
  const viewer = room.participants.get(viewerId)
  const participants: ParticipantView[] = room.order
    .map((id) => room.participants.get(id))
    .filter((p): p is Participant => p !== undefined)
    .map((p) => ({
      id: p.id,
      name: p.name,
      isFacilitator: p.isFacilitator,
      isSpectator: p.isSpectator,
      hasVoted: p.vote !== null,
      vote: room.revealed || p.id === viewerId ? p.vote : null,
    }))

  return {
    roomId: room.id,
    revealed: room.revealed,
    deckType: room.deckType,
    participants,
    you: {
      id: viewerId,
      isFacilitator: viewer?.isFacilitator ?? false,
      isSpectator: viewer?.isSpectator ?? false,
    },
  }
}

function broadcastState(room: Room) {
  for (const participant of room.participants.values()) {
    send(participant.ws, { type: 'state', state: buildStateFor(room, participant.id) })
  }
}

function promoteNextFacilitator(room: Room) {
  const nextId = room.order.find((id) => room.participants.has(id))
  if (nextId) {
    const next = room.participants.get(nextId)
    if (next) next.isFacilitator = true
  }
}

function handleJoin(ws: WebSocket, roomId: string, name: string, isSpectator: boolean) {
  const room = getOrCreateRoom(roomId)

  if (room.participants.size >= MAX_PARTICIPANTS) {
    send(ws, { type: 'error', message: `Room is full (max ${MAX_PARTICIPANTS} players)` })
    ws.close()
    return
  }

  const participantId = nanoid(8)
  const isFacilitator = room.participants.size === 0

  room.participants.set(participantId, {
    id: participantId,
    name,
    vote: null,
    isFacilitator,
    isSpectator,
    ws,
    lastReactionAt: 0,
  })
  room.order.push(participantId)
  connections.set(ws, { roomId, participantId })

  broadcastState(room)
}

function handleVote(room: Room, participantId: string, value: CardValue) {
  const participant = room.participants.get(participantId)
  if (!participant || participant.isSpectator || room.revealed) return
  participant.vote = value
  broadcastState(room)
}

function handleSetDeck(room: Room, participantId: string, deckType: VoteDeckType) {
  const participant = room.participants.get(participantId)
  if (!participant?.isFacilitator || !(deckType in VOTE_DECKS) || room.deckType === deckType) return
  room.deckType = deckType
  room.revealed = false
  for (const currentParticipant of room.participants.values()) currentParticipant.vote = null
  broadcastState(room)
}

function handleSetSpectator(room: Room, participantId: string, isSpectator: boolean) {
  const participant = room.participants.get(participantId)
  if (!participant || typeof isSpectator !== 'boolean' || participant.isSpectator === isSpectator) return
  participant.isSpectator = isSpectator
  if (isSpectator) participant.vote = null
  broadcastState(room)
}

function handleReveal(room: Room, participantId: string) {
  const participant = room.participants.get(participantId)
  const hasVotes = [...room.participants.values()].some((currentParticipant) => currentParticipant.vote)
  if (!participant?.isFacilitator || !hasVotes) return
  room.revealed = true
  broadcastState(room)
}

function handleReset(room: Room, participantId: string) {
  const participant = room.participants.get(participantId)
  if (!participant?.isFacilitator) return
  room.revealed = false
  for (const p of room.participants.values()) p.vote = null
  broadcastState(room)
}

function handleThrowEmoji(
  room: Room,
  participantId: string,
  targetId: string,
  emoji: string,
  count: number | undefined,
) {
  const participant = room.participants.get(participantId)
  if (
    !participant ||
    !room.participants.has(targetId) ||
    typeof emoji !== 'string' ||
    emoji.length === 0 ||
    emoji.length > 32 ||
    !REACTION_COUNTS.includes((count ?? 1) as (typeof REACTION_COUNTS)[number])
  ) {
    return
  }

  const now = Date.now()
  if (now - participant.lastReactionAt < 300) return
  participant.lastReactionAt = now

  for (let reactionIndex = 0; reactionIndex < (count ?? 1); reactionIndex += 1) {
    const id = nanoid(8)
    const message: ServerMessage = {
      type: 'emojiThrown',
      id,
      targetId,
      emoji,
      from: (id.codePointAt(0) ?? 0) % 2 === 0 ? 'left' : 'right',
      startY: randomInt(0, 101),
      impactY: randomInt(15, 86),
    }
    for (const currentParticipant of room.participants.values()) send(currentParticipant.ws, message)
  }
}

function handleClose(ws: WebSocket) {
  const meta = connections.get(ws)
  if (!meta) return
  const room = rooms.get(meta.roomId)
  if (!room) return

  const wasFacilitator = room.participants.get(meta.participantId)?.isFacilitator
  room.participants.delete(meta.participantId)
  room.order = room.order.filter((id) => id !== meta.participantId)

  if (room.participants.size === 0) {
    rooms.delete(meta.roomId)
    return
  }

  if (wasFacilitator) promoteNextFacilitator(room)
  broadcastState(room)
}

const httpServer = createServer()
const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', 'http://localhost')
  const roomId = url.searchParams.get('room')

  if (!roomId) {
    send(ws, { type: 'error', message: 'Missing room id' })
    ws.close()
    return
  }

  ws.on('message', (raw) => {
    let message: ClientMessage
    try {
      message = JSON.parse((raw as Buffer).toString('utf-8'))
    } catch {
      send(ws, { type: 'error', message: 'Invalid message' })
      return
    }

    if (message.type === 'join') {
      handleJoin(ws, roomId, message.name, message.isSpectator)
      return
    }

    const meta = connections.get(ws)
    const room = meta && rooms.get(meta.roomId)
    if (!meta || !room) {
      send(ws, { type: 'error', message: 'Join the room before sending actions' })
      return
    }

    switch (message.type) {
      case 'vote':
        handleVote(room, meta.participantId, message.value)
        break
      case 'setDeck':
        handleSetDeck(room, meta.participantId, message.deckType)
        break
      case 'setSpectator':
        handleSetSpectator(room, meta.participantId, message.isSpectator)
        break
      case 'reveal':
        handleReveal(room, meta.participantId)
        break
      case 'reset':
        handleReset(room, meta.participantId)
        break
      case 'throwEmoji':
        handleThrowEmoji(room, meta.participantId, message.targetId, message.emoji, message.count)
        break
    }
  })

  ws.on('close', () => handleClose(ws))
})

const PORT = 8787
httpServer.listen(PORT, () => {
  console.log(`Planning poker realtime server listening on ws://localhost:${PORT}`)
})
