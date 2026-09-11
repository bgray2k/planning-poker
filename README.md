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

### Abuse protection

The Worker and Durable Object enforce the application-level limits needed for a public WebSocket:

- Room IDs must be six uppercase alphanumeric characters.
- A room accepts at most 30 WebSocket connections and 20 joined participants.
- WebSocket messages are limited to 4 KiB and 40 messages per connection per 10 seconds.
- Participant names are limited to 40 characters.
- Emoji reactions are limited to one per connection every 300 ms.

Also add a Cloudflare dashboard **WAF > Rate limiting rule** for the Worker hostname. Count requests by IP with a starting threshold of 10 WebSocket upgrade requests per 10 seconds, and use **Block** for the action. Scope the expression to the realtime hostname and WebSocket endpoint, for example:

```text
http.host eq "realtime.example.com" and
http.request.uri.path eq "/"
```

Tune the threshold after observing normal reconnect behavior. This rule limits handshake floods; it cannot limit messages on an already-open WebSocket, which is why the Durable Object limits above are also required.
