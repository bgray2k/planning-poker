export { Room } from './room.ts'

export interface Env {
	ROOMS: DurableObjectNamespace
	ALLOWED_ORIGIN: string
}

const ROOM_ID_PATTERN = /^[A-Z0-9]{6}$/

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method !== 'GET') {
			return new Response('Method not allowed', { status: 405 })
		}

		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
			return new Response('Expected a WebSocket upgrade', { status: 426 })
		}

		const requestOrigin = request.headers.get('Origin')
		if (!env.ALLOWED_ORIGIN || requestOrigin !== env.ALLOWED_ORIGIN) {
			return new Response('Forbidden', { status: 403 })
		}

		const roomId = new URL(request.url).searchParams.get('room')?.trim()
		if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
			return new Response('Missing room id', { status: 400 })
		}

		const room = env.ROOMS.get(env.ROOMS.idFromName(roomId))
		return room.fetch(request)
	},
}
