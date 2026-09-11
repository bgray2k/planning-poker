import {
	MAX_PARTICIPANTS,
	VOTE_DECKS,
	type CardValue,
	type ClientMessage,
	type RoomStateView,
	type ServerMessage,
	type VoteDeckType,
} from '../shared/protocol.ts'

interface StoredParticipant {
	id: string
	name: string
	vote: CardValue | null
	isFacilitator: boolean
	isSpectator: boolean
}

interface StoredRoom {
	roomId: string
	revealed: boolean
	deckType: VoteDeckType
	order: string[]
	participants: Record<string, StoredParticipant>
}

interface ConnectionAttachment {
	participantId: string | null
}

const ROOM_STORAGE_KEY = 'room'
const CARD_VALUES = new Set<string>(Object.values(VOTE_DECKS).flat())

function createRoom(roomId: string): StoredRoom {
	return {
		roomId,
		revealed: false,
		deckType: 'storyPoints',
		order: [],
		participants: {},
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isDeckType(value: unknown): value is VoteDeckType {
	return typeof value === 'string' && value in VOTE_DECKS
}

function isCardValue(value: unknown): value is CardValue {
	return typeof value === 'string' && CARD_VALUES.has(value)
}

function parseClientMessage(value: unknown): ClientMessage | null {
	if (!isRecord(value) || typeof value.type !== 'string') return null

	switch (value.type) {
		case 'join':
			return typeof value.name === 'string' && typeof value.isSpectator === 'boolean'
				? { type: 'join', name: value.name, isSpectator: value.isSpectator }
				: null
		case 'vote':
			return isCardValue(value.value) ? { type: 'vote', value: value.value } : null
		case 'setDeck':
			return isDeckType(value.deckType) ? { type: 'setDeck', deckType: value.deckType } : null
		case 'setSpectator':
			return typeof value.isSpectator === 'boolean'
				? { type: 'setSpectator', isSpectator: value.isSpectator }
				: null
		case 'reveal':
		case 'reset':
			return { type: value.type }
		case 'throwEmoji':
			return typeof value.targetId === 'string' && typeof value.emoji === 'string'
				? { type: 'throwEmoji', targetId: value.targetId, emoji: value.emoji }
				: null
		default:
			return null
	}
}

export class Room {
	private roomPromise: Promise<StoredRoom> | null = null
	private roomId: string | null = null

	constructor(private readonly state: DurableObjectState, _env: unknown) {}

	private async getRoom(): Promise<StoredRoom> {
		if (!this.roomPromise) {
			this.roomPromise = this.state.storage
				.get<StoredRoom>(ROOM_STORAGE_KEY)
				.then((room) => room ?? createRoom(this.roomId ?? this.state.id.toString()))
		}
		return this.roomPromise
	}

	private async saveRoom(room: StoredRoom) {
		this.roomPromise = Promise.resolve(room)
		await this.state.storage.put(ROOM_STORAGE_KEY, room)
	}

	private send(ws: WebSocket, message: ServerMessage) {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
	}

	private sendError(ws: WebSocket, message: string) {
		this.send(ws, { type: 'error', message })
	}

	private participantIdFor(ws: WebSocket): string | null {
		const attachment = ws.deserializeAttachment() as ConnectionAttachment | null
		return attachment?.participantId ?? null
	}

	private buildStateFor(room: StoredRoom, viewerId: string): RoomStateView {
		const viewer = room.participants[viewerId]
		const participants = room.order
			.map((id) => room.participants[id])
			.filter((participant): participant is StoredParticipant => participant !== undefined)
			.map((participant) => ({
				id: participant.id,
				name: participant.name,
				isFacilitator: participant.isFacilitator,
				isSpectator: participant.isSpectator,
				hasVoted: participant.vote !== null,
				vote:
					room.revealed || participant.id === viewerId ? participant.vote : null,
			}))

		return {
			roomId: room.roomId,
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

	private async broadcastState(room: StoredRoom) {
		for (const ws of this.state.getWebSockets()) {
			const participantId = this.participantIdFor(ws)
			if (participantId && room.participants[participantId]) {
				this.send(ws, { type: 'state', state: this.buildStateFor(room, participantId) })
			}
		}
	}

	private promoteNextFacilitator(room: StoredRoom) {
		const nextId = room.order.find((id) => room.participants[id])
		if (nextId) room.participants[nextId].isFacilitator = true
	}

	private async handleJoin(ws: WebSocket, message: Extract<ClientMessage, { type: 'join' }>) {
		if (this.participantIdFor(ws)) {
			this.sendError(ws, 'This connection has already joined')
			return
		}

		const room = await this.getRoom()
		if (Object.keys(room.participants).length >= MAX_PARTICIPANTS) {
			this.sendError(ws, `Room is full (max ${MAX_PARTICIPANTS} players)`)
			ws.close(1008, 'Room is full')
			return
		}

		const participantId = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
		room.participants[participantId] = {
			id: participantId,
			name: message.name,
			vote: null,
			isFacilitator: Object.keys(room.participants).length === 0,
			isSpectator: message.isSpectator,
		}
		room.order.push(participantId)
		ws.serializeAttachment({ participantId } satisfies ConnectionAttachment)
		await this.saveRoom(room)
		await this.broadcastState(room)
	}

	private async handleAction(ws: WebSocket, message: Exclude<ClientMessage, { type: 'join' }>) {
		const participantId = this.participantIdFor(ws)
		if (!participantId) {
			this.sendError(ws, 'Join the room before sending actions')
			return
		}

		const room = await this.getRoom()
		const participant = room.participants[participantId]
		if (!participant) {
			this.sendError(ws, 'Participant is no longer in this room')
			return
		}

		switch (message.type) {
			case 'vote':
				if (!participant.isSpectator && !room.revealed) participant.vote = message.value
				break
			case 'setDeck':
				if (participant.isFacilitator && room.deckType !== message.deckType) {
					room.deckType = message.deckType
					room.revealed = false
					for (const currentParticipant of Object.values(room.participants)) {
						currentParticipant.vote = null
					}
				}
				break
			case 'setSpectator':
				if (participant.isSpectator !== message.isSpectator) {
					participant.isSpectator = message.isSpectator
					if (message.isSpectator) participant.vote = null
				}
				break
			case 'reveal':
				if (
					participant.isFacilitator &&
					Object.values(room.participants).some((currentParticipant) => currentParticipant.vote)
				) {
					room.revealed = true
				}
				break
			case 'reset':
				if (participant.isFacilitator) {
					room.revealed = false
					for (const currentParticipant of Object.values(room.participants)) {
						currentParticipant.vote = null
					}
				}
				break
			case 'throwEmoji':
				if (
					room.participants[message.targetId] &&
					message.emoji.length > 0 &&
					message.emoji.length <= 32
				) {
					const reaction: ServerMessage = {
						type: 'emojiThrown',
						id: crypto.randomUUID(),
						targetId: message.targetId,
						emoji: message.emoji,
						from: crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0 ? 'left' : 'right',
						startY: crypto.getRandomValues(new Uint8Array(1))[0] % 101,
					}
					for (const currentWs of this.state.getWebSockets()) this.send(currentWs, reaction)
				}
				return
		}

		await this.saveRoom(room)
		await this.broadcastState(room)
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
			return new Response('Expected a WebSocket upgrade', { status: 426 })
		}
		this.roomId = new URL(request.url).searchParams.get('room')?.trim() ?? null

		const pair = new WebSocketPair()
		const client = pair[0]
		const server = pair[1]
		this.state.acceptWebSocket(server)
		server.serializeAttachment({ participantId: null } satisfies ConnectionAttachment)

		return new Response(null, { status: 101, webSocket: client })
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const raw = typeof message === 'string' ? message : new TextDecoder().decode(message)
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			this.sendError(ws, 'Invalid message')
			return
		}

		const clientMessage = parseClientMessage(parsed)
		if (!clientMessage) {
			this.sendError(ws, 'Invalid message')
			return
		}

		if (clientMessage.type === 'join') {
			await this.handleJoin(ws, clientMessage)
		} else {
			await this.handleAction(ws, clientMessage)
		}
	}

	async webSocketClose(ws: WebSocket) {
		const participantId = this.participantIdFor(ws)
		if (!participantId) return

		const room = await this.getRoom()
		const wasFacilitator = room.participants[participantId]?.isFacilitator ?? false
		delete room.participants[participantId]
		room.order = room.order.filter((id) => id !== participantId)

		if (Object.keys(room.participants).length === 0) {
			this.roomPromise = null
			await this.state.storage.delete(ROOM_STORAGE_KEY)
			return
		}

		if (wasFacilitator) this.promoteNextFacilitator(room)
		await this.saveRoom(room)
		await this.broadcastState(room)
	}

	webSocketError(ws: WebSocket) {
		ws.close()
	}
}
