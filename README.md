# Planning Poker

A real-time planning poker app: a facilitator creates a room, participants join with a name and vote anonymously, and the facilitator reveals/resets each round.

## Stack

- **Frontend**: React + TypeScript + Vite (`src/`)
- **Realtime server (local dev)**: Node + [`ws`](https://github.com/websockets/ws), in-memory rooms (`server/index.ts`)
- **Shared protocol**: message/type contract used by both frontend and server (`shared/protocol.ts`)

The local dev server is intentionally written to match the message protocol that a Cloudflare Durable Object would use, so moving to Cloudflare later is a transport swap, not a rewrite.

## Running locally

```bash
npm install
npm run dev:all   # runs Vite (5173) + the WS room server (8787) together
```

Or run them separately with `npm run dev` and `npm run server`.

## Project structure

```
shared/protocol.ts        # ClientMessage / ServerMessage / RoomStateView types + card deck
server/index.ts           # Local dev realtime server (in-memory, Node + ws)
src/hooks/useRoomConnection.ts  # WebSocket client hook
src/pages/HomePage.tsx    # Create/join room
src/pages/RoomPage.tsx    # Voting room UI
src/components/           # VoteDeck, ParticipantList, RevealControls, ShareLink
```

---

## Deploying to Cloudflare (Pages + Durable Objects)

This is **not yet set up** — the steps below are what's needed when you're ready to deploy.

### Why this shape

- **Cloudflare Pages** hosts the static built frontend (`npm run build` output).
- **Cloudflare Workers + Durable Objects** replace `server/index.ts`. A Durable Object gives you one strongly-consistent, in-memory instance per room — exactly what `Room` in `server/index.ts` models — and it natively supports WebSockets, so the `shared/protocol.ts` message contract carries over unchanged.
- Pages can route specific paths (e.g. `/ws/*`) to a Worker via a `_routes.json` / Pages Functions binding, so the frontend and realtime backend can be served from a single custom domain with no CORS concerns.

### What you'll need

1. **A Cloudflare account** (free tier is sufficient) and `wrangler` CLI (`npm install -D wrangler`).
2. **A Worker project for the Durable Object**, separate from the Vite app, e.g. `worker/`:
   - `worker/room.ts` — a `DurableObject` class holding the same state shape as `Room` in `server/index.ts` (`revealed`, `order`, `participants`), with a `fetch` handler that upgrades to a WebSocket and reuses the `handleJoin` / `handleVote` / `handleReveal` / `handleReset` logic.
   - `worker/index.ts` — a Worker entrypoint that looks up the Durable Object by room id (`env.ROOMS.idFromName(roomId)`) and forwards the request to it.
   - `wrangler.toml` declaring the Durable Object binding:
     ```toml
     name = "planning-poker-worker"
     main = "worker/index.ts"
     compatibility_date = "2024-01-01"

     [[durable_objects.bindings]]
     name = "ROOMS"
     class_name = "Room"

     [[migrations]]
     tag = "v1"
     new_sqlite_classes = ["Room"]
     ```
3. **Use the WebSocket Hibernation API** (`state.acceptWebSocket(ws)` instead of plain `ws.accept()`) so idle rooms don't keep the Durable Object billed as active — recommended for this kind of low-traffic, bursty connection pattern.
4. **Frontend env var**: set `VITE_WS_URL` (already read in `src/hooks/useRoomConnection.ts`) to the deployed Worker's `wss://` URL at build time, via a `.env.production` file or Cloudflare Pages' project environment variables.
5. **Cloudflare Pages project**:
   - Connect the repo, build command `npm run build`, output directory `dist`.
   - If you want the Worker reachable on the same domain (e.g. `/ws`), add a Pages Function or a `_routes.json` that proxies matching requests to the Worker service binding, instead of hitting the Worker's own `workers.dev` URL directly.
6. **Deploy**:
   ```bash
   npx wrangler deploy              # deploys the Durable Object Worker
   npx wrangler pages deploy dist   # deploys the built frontend
   ```
7. **CORS / origin checks**: the Durable Object's `fetch` handler should validate the `Origin` header against your Pages domain before upgrading to a WebSocket, since Workers have no built-in same-origin protection.

### Migration checklist (server/index.ts → Durable Object)

- [ ] Port `Room`, `Participant`, `getOrCreateRoom` → Durable Object instance state (one object per room id).
- [ ] Port `handleJoin` / `handleVote` / `handleReveal` / `handleReset` / `handleClose` logic into the DO's `webSocketMessage` / `webSocketClose` hibernation handlers.
- [ ] Replace `WeakMap<WebSocket, meta>` connection tracking with `ws.serializeAttachment()` / `ws.deserializeAttachment()` (hibernation-safe alternative).
- [ ] Set `VITE_WS_URL` for production builds.
- [ ] Add origin validation in the Worker's `fetch` handler.
