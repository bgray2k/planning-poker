import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  CardValue,
  ClientMessage,
  RoomStateView,
  ReactionCount,
  ServerMessage,
  VoteDeckType,
} from '../../shared/protocol.ts'

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787'

export interface EmojiReaction {
  id: string
  targetId: string
  emoji: string
  from: 'left' | 'right'
  startY: number
  impactY?: number
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

  useEffect(() => {
    if (!name) return

    const ws = new WebSocket(`${WS_URL}/?room=${encodeURIComponent(roomId)}`)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      setConnected(true)
      setError(null)
      send({ type: 'join', name, isSpectator })
    })

    ws.addEventListener('message', (event) => {
      const message: ServerMessage = JSON.parse(event.data)
      if (message.type === 'state') setState(message.state)
      if (message.type === 'error') setError(message.message)
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

    ws.addEventListener('close', () => setConnected(false))

    function send(message: ClientMessage) {
      ws.send(JSON.stringify(message))
    }

    return () => {
      ws.close()
      wsRef.current = null
      if (notificationTimerRef.current !== null) window.clearTimeout(notificationTimerRef.current)
    }
  }, [roomId, name, isSpectator])

  const sendMessage = useCallback((message: ClientMessage) => {
    wsRef.current?.send(JSON.stringify(message))
  }, [])

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
  const makeFacilitator = useCallback(
    (participantId: string) => sendMessage({ type: 'makeFacilitator', participantId }),
    [sendMessage],
  )
  const throwEmoji = useCallback(
    (targetId: string, emoji: string, count: ReactionCount = 1) => {
      const now = Date.now()
      if (now - lastReactionAtRef.current < 300) return
      lastReactionAtRef.current = now
      sendMessage({ type: 'throwEmoji', targetId, emoji, count })
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
    makeFacilitator,
    throwEmoji,
  }
}
