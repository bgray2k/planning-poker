import {
	MAX_PARTICIPANTS,
	REACTION_COUNTS,
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
	messageWindowStart: number
	messageCount: number
	lastReactionAt: number
}

const ROOM_STORAGE_KEY = 'room'
const CARD_VALUES = new Set<string>(Object.values(VOTE_DECKS).flat())
const ROOM_ID_PATTERN = /^[A-Z0-9]{6}$/
const MAX_MESSAGE_BYTES = 4096
const MESSAGE_WINDOW_MS = 10_000
const MAX_MESSAGES_PER_WINDOW = 40
const REACTION_COOLDOWN_MS = 300
const MAX_NAME_LENGTH = 40
const MAX_CONNECTIONS_PER_ROOM = 30

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
			return typeof value.name === 'string' &&
				value.name.trim().length > 0 &&
				value.name.length <= MAX_NAME_LENGTH &&
				typeof value.isSpectator === 'boolean'
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
		case 'makeFacilitator':
			return typeof value.participantId === 'string'
				? { type: 'makeFacilitator', participantId: value.participantId }
				: null
		case 'throwEmoji':
			return typeof value.targetId === 'string' &&
				typeof value.emoji === 'string' &&
				(value.count === undefined || REACTION_COUNTS.includes(value.count as (typeof REACTION_COUNTS)[number]))
				? { type: 'throwEmoji', targetId: value.targetId, emoji: value.emoji, count: value.count as (typeof REACTION_COUNTS)[number] | undefined }
				: null
		default:
			return null
	}
}

export class Room {
	private roomPromise: Promise<StoredRoom> | null = null
	private roomId: string | null = null
	private readonly clearingSockets = new Set<WebSocket>()

	constructor(private readonly state: DurableObjectState, _env: unknown) {}

	private async clearRoom() {
		for (const ws of this.state.getWebSockets()) {
			this.clearingSockets.add(ws)
			ws.close(1001, 'Room cleared by administrator')
		}
		this.roomPromise = null
		await this.state.storage.delete(ROOM_STORAGE_KEY)
	}

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
			name: message.name.trim(),
			vote: null,
			isFacilitator: Object.keys(room.participants).length === 0,
			isSpectator: message.isSpectator,
		}
		room.order.push(participantId)
		const attachment = this.connectionAttachment(ws)
		attachment.participantId = participantId
		ws.serializeAttachment(attachment)
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
					Object.values(room.participants).some((currentParticipant) => !currentParticipant.isSpectator) &&
					Object.values(room.participants)
						.filter((currentParticipant) => !currentParticipant.isSpectator)
						.every((currentParticipant) => currentParticipant.vote !== null)
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
			case 'makeFacilitator':
				if (participant.isFacilitator && room.participants[message.participantId] && message.participantId !== participantId) {
					const target = room.participants[message.participantId]
					participant.isFacilitator = false
					target.isFacilitator = true
					for (const currentWs of this.state.getWebSockets()) {
						this.send(currentWs, {
							type: 'hostTransferred',
							actorName: participant.name,
							targetName: target.name,
						})
					}
				}
				break
			case 'throwEmoji':
				const reactionCount = message.count ?? 1
				if (
					room.participants[message.targetId] &&
					message.emoji.length > 0 &&
					message.emoji.length <= 32 &&
					REACTION_COUNTS.includes(reactionCount) &&
					Date.now() - this.connectionAttachment(ws).lastReactionAt >= REACTION_COOLDOWN_MS
				) {
					const attachment = this.connectionAttachment(ws)
					attachment.lastReactionAt = Date.now()
					ws.serializeAttachment(attachment)
					for (let reactionIndex = 0; reactionIndex < reactionCount; reactionIndex += 1) {
						const reaction: ServerMessage = {
							type: 'emojiThrown',
							id: crypto.randomUUID(),
							targetId: message.targetId,
							emoji: message.emoji,
							from: crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0 ? 'left' : 'right',
							startY: crypto.getRandomValues(new Uint8Array(1))[0] % 101,
							impactY: crypto.getRandomValues(new Uint8Array(1))[0] % 71 + 15,
						}
						for (const currentWs of this.state.getWebSockets()) this.send(currentWs, reaction)
					}
				}
				return
		}

		await this.saveRoom(room)
		await this.broadcastState(room)
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method === 'POST' && new URL(request.url).pathname === '/internal/clear') {
			await this.clearRoom()
			return new Response('Room cleared')
		}

		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
			return new Response('Expected a WebSocket upgrade', { status: 426 })
		}
		this.roomId = new URL(request.url).searchParams.get('room')?.trim() ?? null
		if (!this.roomId || !ROOM_ID_PATTERN.test(this.roomId)) {
			return new Response('Invalid room id', { status: 400 })
		}
		if (this.state.getWebSockets().length >= MAX_CONNECTIONS_PER_ROOM) {
			return new Response('Too many connections', { status: 429 })
		}
		const pair = new WebSocketPair()
		const client = pair[0]
		const server = pair[1]
		this.state.acceptWebSocket(server)
		server.serializeAttachment({
			participantId: null,
			messageWindowStart: Date.now(),
			messageCount: 0,
			lastReactionAt: 0,
		} satisfies ConnectionAttachment)

		return new Response(null, { status: 101, webSocket: client })
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const rawBytes = typeof message === 'string'
			? message.length > MAX_MESSAGE_BYTES
				? MAX_MESSAGE_BYTES + 1
				: new TextEncoder().encode(message).byteLength
			: message.byteLength
		if (rawBytes > MAX_MESSAGE_BYTES) {
			this.sendError(ws, 'Message is too large')
			ws.close(1009, 'Message is too large')
			return
		}

		const attachment = this.connectionAttachment(ws)
		const now = Date.now()
		if (now - attachment.messageWindowStart >= MESSAGE_WINDOW_MS) {
			attachment.messageWindowStart = now
			attachment.messageCount = 0
		}
		attachment.messageCount += 1
		ws.serializeAttachment(attachment)
		if (attachment.messageCount > MAX_MESSAGES_PER_WINDOW) {
			this.sendError(ws, 'Too many messages')
			ws.close(1008, 'Rate limit exceeded')
			return
		}

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
		if (this.clearingSockets.delete(ws)) return
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

	private connectionAttachment(ws: WebSocket): ConnectionAttachment {
		return ws.deserializeAttachment() as ConnectionAttachment
	}
}

const ROOM_IDS_STORAGE_KEY = 'room-ids'

export class RoomRegistry {
	constructor(private readonly state: DurableObjectState, private readonly env: { ROOMS: DurableObjectNamespace }) {}

	async fetch(request: Request): Promise<Response> {
		const pathname = new URL(request.url).pathname
		const roomIds = (await this.state.storage.get<string[]>(ROOM_IDS_STORAGE_KEY)) ?? []

		if (request.method === 'POST' && pathname === '/register') {
			const roomId = await request.text()
			if (/^[A-Z0-9]{6}$/.test(roomId) && !roomIds.includes(roomId)) {
				roomIds.push(roomId)
				await this.state.storage.put(ROOM_IDS_STORAGE_KEY, roomIds)
			}
			return new Response('Registered')
		}

		if (request.method === 'POST' && pathname === '/clear-all') {
			await Promise.all(roomIds.map((roomId) => {
				const room = this.env.ROOMS.get(this.env.ROOMS.idFromName(roomId))
				return room.fetch(new Request('https://internal/clear', { method: 'POST' }))
			}))
			await this.state.storage.delete(ROOM_IDS_STORAGE_KEY)
			return Response.json({ clearedRooms: roomIds.length })
		}

		return new Response('Not found', { status: 404 })
	}
}
