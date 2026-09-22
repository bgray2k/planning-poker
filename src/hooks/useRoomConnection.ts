import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  AFK_TIMEOUT_MESSAGE,
  END_SESSION_MESSAGE,
  KICKED_MESSAGE,
  type CardValue,
  type ClientMessage,
  type RoomStateView,
  type ReactionCount,
  type ReactionSpeed,
  type ServerMessage,
  type VoteDeckType,
} from '../../shared/protocol.ts'

declare global {
  interface Window {
    makeMeHost?: () => void
  }
}

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787'
const ALLOWED_ROOM_IDS = new Set(['NOVA', 'HORIZON'])
const ROOM_NOT_FOUND_MESSAGE = 'Room does not exist'

function getClientId(roomId: string) {
  const storageKey = `planning-poker-client:${roomId}`
  const existingClientId = window.localStorage.getItem(storageKey)
  if (existingClientId) return existingClientId

  const clientId = crypto.randomUUID()
  window.localStorage.setItem(storageKey, clientId)
  return clientId
}

export interface EmojiReaction {
  id: string
  targetId: string
  emoji: string
  from: 'left' | 'right'
  startY: number
  impactY?: number
  speed?: ReactionSpeed
}

function removeReaction(
  setReactions: Dispatch<SetStateAction<EmojiReaction[]>>,
  reactionId: string,
) {
  setReactions((current) => current.filter((reaction) => reaction.id !== reactionId))
}

export function useRoomConnection(roomId: string, name: string | null, isSpectator: boolean) {
  const [state, setState] = useState<RoomStateView | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [reactions, setReactions] = useState<EmojiReaction[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const lastReactionAtRef = useRef(0)
  const notificationTimerRef = useRef<number | null>(null)
  const sendMessage = useCallback((message: ClientMessage) => {
    wsRef.current?.send(JSON.stringify(message))
  }, [])

  useEffect(() => {
    if (!name) return
    if (!ALLOWED_ROOM_IDS.has(roomId.trim().toUpperCase())) {
      setError(ROOM_NOT_FOUND_MESSAGE)
      setConnected(false)
      return
    }

    const ws = new WebSocket(`${WS_URL}/?room=${encodeURIComponent(roomId)}`)
    const clientId = getClientId(roomId.trim().toUpperCase())
    wsRef.current = ws

    ws.addEventListener('open', () => {
      setConnected(true)
      setError(null)
      send({ type: 'join', name, isSpectator, clientId })
    })

    ws.addEventListener('message', (event) => {
      const message: ServerMessage = JSON.parse(event.data)
      if (message.type === 'state') setState(message.state)
      if (message.type === 'error') {
        setError(message.message)
        if (message.message === AFK_TIMEOUT_MESSAGE) {
          window.setTimeout(() => {
            window.location.assign('/')
          }, 300)
        }
      }
      if (message.type === 'hostTransferred') {
        setNotification(`${message.actorName} made ${message.targetName} the host!`)
        if (notificationTimerRef.current !== null) window.clearTimeout(notificationTimerRef.current)
        notificationTimerRef.current = window.setTimeout(() => {
          setNotification(null)
          notificationTimerRef.current = null
        }, 3000)
      }
      if (message.type === 'emojiThrown') {
        setReactions((current) => [...current, message])
        window.setTimeout(() => {
          removeReaction(setReactions, message.id)
        }, 8000)
      }
    })

    ws.addEventListener('close', (event) => {
      setConnected(false)
      if (event.reason === AFK_TIMEOUT_MESSAGE) {
        window.location.assign('/')
      }
      if (event.reason === END_SESSION_MESSAGE) window.location.assign('/')
      if (event.reason === KICKED_MESSAGE) window.location.assign('/')
    })

    function send(message: ClientMessage) {
      ws.send(JSON.stringify(message))
    }

    return () => {
      ws.close()
      wsRef.current = null
      if (notificationTimerRef.current !== null) window.clearTimeout(notificationTimerRef.current)
    }
  }, [roomId, name, isSpectator])

  useEffect(() => {
    window.makeMeHost = () => sendMessage({ type: 'claimFacilitator' })
    return () => {
      delete window.makeMeHost
    }
  }, [sendMessage])

  const vote = useCallback((value: CardValue) => sendMessage({ type: 'vote', value }), [sendMessage])
  const setDeck = useCallback(
    (deckType: VoteDeckType) => sendMessage({ type: 'setDeck', deckType }),
    [sendMessage],
  )
  const setSpectator = useCallback(
    (isSpectator: boolean) => sendMessage({ type: 'setSpectator', isSpectator }),
    [sendMessage],
  )
  const reveal = useCallback(() => sendMessage({ type: 'reveal' }), [sendMessage])
  const reset = useCallback(() => sendMessage({ type: 'reset' }), [sendMessage])
  const endSession = useCallback(() => sendMessage({ type: 'endSession' }), [sendMessage])
  const makeFacilitator = useCallback(
    (participantId: string) => sendMessage({ type: 'makeFacilitator', participantId }),
    [sendMessage],
  )
  const kickParticipant = useCallback(
    (participantId: string) => sendMessage({ type: 'kickParticipant', participantId }),
    [sendMessage],
  )
  const throwEmoji = useCallback(
    (targetId: string, emoji: string, count: ReactionCount = 1, speed: ReactionSpeed = 1) => {
      const now = Date.now()
      if (now - lastReactionAtRef.current < 300) return
      lastReactionAtRef.current = now
      sendMessage({ type: 'throwEmoji', targetId, emoji, count, speed })
    },
    [sendMessage],
  )

  return {
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
  }
}
