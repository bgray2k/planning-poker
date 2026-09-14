export { Room, RoomRegistry } from './room.ts'

export interface Env {
	ROOMS: DurableObjectNamespace
	ROOM_REGISTRY: DurableObjectNamespace
	ALLOWED_ORIGIN: string
	ADMIN_TOKEN: string
}

const ROOM_ID_PATTERN = /^[A-Z0-9]{6}$/

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url)
		if (url.pathname === '/admin/clear-all') {
			if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
			const authorization = request.headers.get('Authorization')
			if (!env.ADMIN_TOKEN || authorization !== `Bearer ${env.ADMIN_TOKEN}`) {
				return new Response('Unauthorized', { status: 401 })
			}

			const registry = env.ROOM_REGISTRY.get(env.ROOM_REGISTRY.idFromName('global'))
			return registry.fetch(new Request('https://internal/clear-all', { method: 'POST' }))
		}

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

		const registry = env.ROOM_REGISTRY.get(env.ROOM_REGISTRY.idFromName('global'))
		await registry.fetch(new Request('https://internal/register', { method: 'POST', body: roomId }))
		const room = env.ROOMS.get(env.ROOMS.idFromName(roomId))
		return room.fetch(request)
	},
}
