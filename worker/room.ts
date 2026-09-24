import {
  AFK_TIMEOUT_MESSAGE,
  AFK_TIMEOUT_MS,
  END_SESSION_MESSAGE,
  isRoomId,
  KICKED_MESSAGE,
  MAX_PARTICIPANTS,
  REACTION_COUNTS,
  REACTION_SPEEDS,
  VOTE_DECKS,
  type CardValue,
  type ClientMessage,
  type ReactionCount,
  type ReactionSpeed,
  type RoomStateView,
  type ServerMessage,
  type VoteDeckType,
} from "../shared/protocol.ts";

interface StoredParticipant {
  id: string;
  clientId?: string;
  name: string;
  vote: CardValue | null;
  isFacilitator: boolean;
  isSpectator: boolean;
}

interface StoredRoom {
  roomId: string;
  revealed: boolean;
  deckType: VoteDeckType;
  order: string[];
  participants: Record<string, StoredParticipant>;
}

interface ConnectionAttachment {
  participantId: string | null;
  messageWindowStart: number;
  messageCount: number;
  lastReactionAt: number;
  lastActivityAt: number;
}

const ROOM_STORAGE_KEY = "room";
const CARD_VALUES = new Set<string>(Object.values(VOTE_DECKS).flat());
const MAX_MESSAGE_BYTES = 4096;
const MESSAGE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 40;
const REACTION_COOLDOWN_MS = 300;
const MAX_NAME_LENGTH = 12;
const MAX_CONNECTIONS_PER_ROOM = MAX_PARTICIPANTS;

function createRoom(roomId: string): StoredRoom {
  return {
    roomId,
    revealed: false,
    deckType: "storyPoints",
    order: [],
    participants: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDeckType(value: unknown): value is VoteDeckType {
  return typeof value === "string" && value in VOTE_DECKS;
}

function isCardValue(value: unknown): value is CardValue {
  return typeof value === "string" && CARD_VALUES.has(value);
}

function isOptionalReactionCount(
  value: unknown,
): value is ReactionCount | undefined {
  return value === undefined || REACTION_COUNTS.includes(value as ReactionCount);
}

function isOptionalReactionSpeed(
  value: unknown,
): value is ReactionSpeed | undefined {
  return value === undefined || REACTION_SPEEDS.includes(value as ReactionSpeed);
}

function parseJoinMessage(value: Record<string, unknown>): ClientMessage | null {
  const { name, isSpectator, clientId } = value;
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.length > MAX_NAME_LENGTH ||
    typeof isSpectator !== "boolean" ||
    typeof clientId !== "string" ||
    clientId.length === 0 ||
    clientId.length > 128
  ) {
    return null;
  }

  return { type: "join", name, isSpectator, clientId };
}

function parseThrowEmojiMessage(
  value: Record<string, unknown>,
): ClientMessage | null {
  const { targetId, emoji, count, speed } = value;
  if (
    typeof targetId !== "string" ||
    typeof emoji !== "string" ||
    !isOptionalReactionCount(count) ||
    !isOptionalReactionSpeed(speed)
  ) {
    return null;
  }

  return { type: "throwEmoji", targetId, emoji, count, speed };
}

function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "join":
      return parseJoinMessage(value);
    case "vote":
      return isCardValue(value.value)
        ? { type: "vote", value: value.value }
        : null;
    case "setDeck":
      return isDeckType(value.deckType)
        ? { type: "setDeck", deckType: value.deckType }
        : null;
    case "setSpectator":
      return typeof value.isSpectator === "boolean"
        ? { type: "setSpectator", isSpectator: value.isSpectator }
        : null;
    case "reveal":
    case "reset":
      return { type: value.type };
    case "makeFacilitator":
      return typeof value.participantId === "string"
        ? { type: "makeFacilitator", participantId: value.participantId }
        : null;
    case "kickParticipant":
      return typeof value.participantId === "string"
        ? { type: "kickParticipant", participantId: value.participantId }
        : null;
    case "claimFacilitator":
    case "endSession":
      return { type: value.type };
    case "throwEmoji":
      return parseThrowEmojiMessage(value);
    default:
      return null;
  }
}

function getRawMessageBytes(message: string | ArrayBuffer): number {
  if (typeof message !== "string") return message.byteLength;
  if (message.length > MAX_MESSAGE_BYTES) return MAX_MESSAGE_BYTES + 1;
  return new TextEncoder().encode(message).byteLength;
}

export class Room {
  private roomPromise: Promise<StoredRoom> | null = null;
  private roomId: string | null = null;

  constructor(
    private readonly state: DurableObjectState,
    _env: unknown,
  ) {}

  private scheduleAfkCheck(timestamp: number) {
    void this.state.storage.setAlarm(timestamp);
  }

  private async deleteAlarms() {
    await this.state.storage.deleteAlarm();
  }

  private async getRoom(): Promise<StoredRoom> {
    this.roomPromise ??= this.state.storage
      .get<StoredRoom>(ROOM_STORAGE_KEY)
      .then(
        (room) => room ?? createRoom(this.roomId ?? this.state.id.toString()),
      );
    return this.roomPromise;
  }

  private async saveRoom(room: StoredRoom) {
    this.roomPromise = Promise.resolve(room);
    await this.state.storage.put(ROOM_STORAGE_KEY, room);
  }

  private send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  private sendError(ws: WebSocket, message: string) {
    this.send(ws, { type: "error", message });
  }

  private participantIdFor(ws: WebSocket): string | null {
    const attachment =
      ws.deserializeAttachment() as ConnectionAttachment | null;
    return attachment?.participantId ?? null;
  }

  private buildStateFor(room: StoredRoom, viewerId: string): RoomStateView {
    const viewer = room.participants[viewerId];
    const participants = room.order
      .map((id) => room.participants[id])
      .filter(
        (participant): participant is StoredParticipant =>
          participant !== undefined,
      )
      .map((participant) => ({
        id: participant.id,
        name: participant.name,
        isFacilitator: participant.isFacilitator,
        isSpectator: participant.isSpectator,
        hasVoted: participant.vote !== null,
        vote:
          room.revealed || participant.id === viewerId
            ? participant.vote
            : null,
      }));

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
    };
  }

  private async broadcastState(room: StoredRoom) {
    for (const ws of this.state.getWebSockets()) {
      const participantId = this.participantIdFor(ws);
      if (participantId && room.participants[participantId]) {
        this.send(ws, {
          type: "state",
          state: this.buildStateFor(room, participantId),
        });
      }
    }
  }

  private promoteNextFacilitator(room: StoredRoom) {
    const nextId = room.order.find((id) => room.participants[id]);
    if (nextId) room.participants[nextId].isFacilitator = true;
  }

  private async handleJoin(
    ws: WebSocket,
    message: Extract<ClientMessage, { type: "join" }>,
  ) {
    if (this.participantIdFor(ws)) {
      this.sendError(ws, "This connection has already joined");
      return;
    }

    const room = await this.getRoom();
    const existingParticipant = Object.values(room.participants).find(
      (participant) =>
        participant.clientId === message.clientId ||
        (!participant.clientId && participant.name === message.name.trim()),
    );
    const shouldBeFacilitator =
      existingParticipant?.isFacilitator ??
      Object.keys(room.participants).length === 0;
    if (existingParticipant) {
      for (const currentWs of this.state.getWebSockets()) {
        if (
          this.participantIdFor(currentWs) === existingParticipant.id &&
          currentWs !== ws
        ) {
          currentWs.close(1000, "Reconnected");
        }
      }
      delete room.participants[existingParticipant.id];
      room.order = room.order.filter((id) => id !== existingParticipant.id);
    }
    if (Object.keys(room.participants).length >= MAX_PARTICIPANTS) {
      this.sendError(ws, `Room is full (max ${MAX_PARTICIPANTS} players)`);
      ws.close(1008, "Room is full");
      return;
    }

    const participantId = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
    room.participants[participantId] = {
      id: participantId,
      clientId: message.clientId,
      name: message.name.trim(),
      vote: null,
      isFacilitator: shouldBeFacilitator,
      isSpectator: message.isSpectator,
    };
    room.order.push(participantId);
    const attachment = this.connectionAttachment(ws);
    attachment.participantId = participantId;
    attachment.lastActivityAt = Date.now();
    ws.serializeAttachment(attachment);
    await this.saveRoom(room);
    await this.broadcastState(room);
  }

  private clearVotes(room: StoredRoom) {
    for (const participant of Object.values(room.participants)) {
      participant.vote = null;
    }
  }

  private applyVote(
    room: StoredRoom,
    participant: StoredParticipant,
    value: CardValue,
  ): boolean {
    if (participant.isSpectator || room.revealed || participant.vote === value)
      return false;
    participant.vote = value;
    return true;
  }

  private applyDeck(
    room: StoredRoom,
    participant: StoredParticipant,
    deckType: VoteDeckType,
  ): boolean {
    if (!participant.isFacilitator || room.deckType === deckType) return false;
    room.deckType = deckType;
    room.revealed = false;
    this.clearVotes(room);
    return true;
  }

  private applySpectatorSetting(
    participant: StoredParticipant,
    isSpectator: boolean,
  ): boolean {
    if (participant.isSpectator === isSpectator) return false;
    participant.isSpectator = isSpectator;
    if (isSpectator) participant.vote = null;
    return true;
  }

  private revealVotes(
    room: StoredRoom,
    participant: StoredParticipant,
  ): boolean {
    if (
      !participant.isFacilitator ||
      room.revealed ||
      !Object.values(room.participants).some(
        (currentParticipant) =>
          !currentParticipant.isSpectator && currentParticipant.vote !== null,
      )
    ) {
      return false;
    }
    room.revealed = true;
    return true;
  }

  private resetVotes(
    room: StoredRoom,
    participant: StoredParticipant,
  ): boolean {
    const hasVotes = Object.values(room.participants).some(
      (currentParticipant) => currentParticipant.vote !== null,
    );
    if (!participant.isFacilitator || (!room.revealed && !hasVotes)) return false;
    room.revealed = false;
    this.clearVotes(room);
    return true;
  }

  private transferFacilitator(
    room: StoredRoom,
    participantId: string,
    participant: StoredParticipant,
    targetId: string,
  ): boolean {
    const target = room.participants[targetId];
    if (!participant.isFacilitator || !target || targetId === participantId)
      return false;

    participant.isFacilitator = false;
    target.isFacilitator = true;
    for (const currentWs of this.state.getWebSockets()) {
      this.send(currentWs, {
        type: "hostTransferred",
        actorName: participant.name,
        targetName: target.name,
      });
    }
    return true;
  }

  private async clearRoomStorage() {
    this.roomPromise = null;
    await this.deleteAlarms();
    await this.state.storage.deleteAll();
  }

  private async kickParticipant(
    room: StoredRoom,
    participantId: string,
    participant: StoredParticipant,
    targetId: string,
  ): Promise<boolean> {
    if (
      !participant.isFacilitator ||
      !room.participants[targetId] ||
      targetId === participantId
    ) {
      return false;
    }

    delete room.participants[targetId];
    room.order = room.order.filter((id) => id !== targetId);
    for (const currentWs of this.state.getWebSockets()) {
      if (this.participantIdFor(currentWs) === targetId) {
        currentWs.close(1000, KICKED_MESSAGE);
      }
    }
    if (Object.keys(room.participants).length === 0) {
      await this.clearRoomStorage();
      return false;
    }
    return true;
  }

  private claimFacilitator(room: StoredRoom, participantId: string): boolean {
    let hasChanges = false;
    for (const participant of Object.values(room.participants)) {
      const shouldBeFacilitator = participant.id === participantId;
      if (participant.isFacilitator !== shouldBeFacilitator) {
        participant.isFacilitator = shouldBeFacilitator;
        hasChanges = true;
      }
    }
    return hasChanges;
  }

  private async endSession(participant: StoredParticipant): Promise<void> {
    if (!participant.isFacilitator) return;
    for (const currentWs of this.state.getWebSockets()) {
      currentWs.close(1000, END_SESSION_MESSAGE);
    }
    await this.clearRoomStorage();
  }

  private throwEmoji(
    ws: WebSocket,
    room: StoredRoom,
    message: Extract<ClientMessage, { type: "throwEmoji" }>,
  ) {
    const reactionCount = message.count ?? 1;
    const reactionSpeed = message.speed ?? 1;
    const attachment = this.connectionAttachment(ws);
    if (
      !room.participants[message.targetId] ||
      message.emoji.length === 0 ||
      message.emoji.length > 32 ||
      !REACTION_COUNTS.includes(reactionCount) ||
      !REACTION_SPEEDS.includes(reactionSpeed) ||
      Date.now() - attachment.lastReactionAt < REACTION_COOLDOWN_MS
    ) {
      return;
    }

    attachment.lastReactionAt = Date.now();
    ws.serializeAttachment(attachment);
    for (
      let reactionIndex = 0;
      reactionIndex < reactionCount;
      reactionIndex += 1
    ) {
      const reaction: ServerMessage = {
        type: "emojiThrown",
        id: crypto.randomUUID(),
        targetId: message.targetId,
        emoji: message.emoji,
        from:
          crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0
            ? "left"
            : "right",
        startY: crypto.getRandomValues(new Uint8Array(1))[0] % 101,
        impactY: (crypto.getRandomValues(new Uint8Array(1))[0] % 71) + 15,
        speed: reactionSpeed,
      };
      for (const currentWs of this.state.getWebSockets()) {
        this.send(currentWs, reaction);
      }
    }
  }

  private async applyAction(
    ws: WebSocket,
    room: StoredRoom,
    participantId: string,
    participant: StoredParticipant,
    message: Exclude<ClientMessage, { type: "join" }>,
  ): Promise<boolean> {
    switch (message.type) {
      case "vote":
        return this.applyVote(room, participant, message.value);
      case "setDeck":
        return this.applyDeck(room, participant, message.deckType);
      case "setSpectator":
        return this.applySpectatorSetting(participant, message.isSpectator);
      case "reveal":
        return this.revealVotes(room, participant);
      case "reset":
        return this.resetVotes(room, participant);
      case "makeFacilitator":
        return this.transferFacilitator(
          room,
          participantId,
          participant,
          message.participantId,
        );
      case "kickParticipant":
        return this.kickParticipant(
          room,
          participantId,
          participant,
          message.participantId,
        );
      case "claimFacilitator":
        return this.claimFacilitator(room, participantId);
      case "endSession":
        await this.endSession(participant);
        return false;
      case "throwEmoji":
        this.throwEmoji(ws, room, message);
        return false;
      default:
        return false;
    }
  }

  private async handleAction(
    ws: WebSocket,
    message: Exclude<ClientMessage, { type: "join" }>,
  ) {
    const participantId = this.participantIdFor(ws);
    if (!participantId) {
      this.sendError(ws, "Join the room before sending actions");
      return;
    }

    const attachment = this.connectionAttachment(ws);
    attachment.lastActivityAt = Date.now();
    ws.serializeAttachment(attachment);

    const room = await this.getRoom();
    const participant = room.participants[participantId];
    if (!participant) {
      this.sendError(ws, "Participant is no longer in this room");
      return;
    }

    const hasChanges = await this.applyAction(
      ws,
      room,
      participantId,
      participant,
      message,
    );
    if (hasChanges) {
      await this.saveRoom(room);
      await this.broadcastState(room);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    this.roomId =
      new URL(request.url).searchParams.get("room")?.trim().toUpperCase() ??
      null;
    if (!this.roomId || !isRoomId(this.roomId)) {
      return new Response("Invalid room id", { status: 400 });
    }
    if (this.state.getWebSockets().length >= MAX_CONNECTIONS_PER_ROOM) {
      return new Response("Too many connections", { status: 429 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    const lastActivityAt = Date.now();
    server.serializeAttachment({
      participantId: null,
      messageWindowStart: lastActivityAt,
      messageCount: 0,
      lastReactionAt: 0,
      lastActivityAt,
    } satisfies ConnectionAttachment);

    this.scheduleAfkCheck(lastActivityAt + AFK_TIMEOUT_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = this.connectionAttachment(ws);
    attachment.lastActivityAt = Date.now();
    ws.serializeAttachment(attachment);

    const rawBytes = getRawMessageBytes(message);
    if (rawBytes > MAX_MESSAGE_BYTES) {
      this.sendError(ws, "Message is too large");
      ws.close(1009, "Message is too large");
      return;
    }

    const now = Date.now();
    if (now - attachment.messageWindowStart >= MESSAGE_WINDOW_MS) {
      attachment.messageWindowStart = now;
      attachment.messageCount = 0;
    }
    attachment.messageCount += 1;
    ws.serializeAttachment(attachment);
    if (attachment.messageCount > MAX_MESSAGES_PER_WINDOW) {
      this.sendError(ws, "Too many messages");
      ws.close(1008, "Rate limit exceeded");
      return;
    }

    const raw =
      typeof message === "string" ? message : new TextDecoder().decode(message);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendError(ws, "Invalid message");
      return;
    }

    const clientMessage = parseClientMessage(parsed);
    if (!clientMessage) {
      this.sendError(ws, "Invalid message");
      return;
    }

    if (clientMessage.type === "join") {
      await this.handleJoin(ws, clientMessage);
    } else {
      await this.handleAction(ws, clientMessage);
    }
  }

  async webSocketClose(ws: WebSocket) {
    const activitySocket = this.state
      .getWebSockets()
      .find((currentWs) => currentWs !== ws);
    if (activitySocket) {
      const attachment = this.connectionAttachment(activitySocket);
      attachment.lastActivityAt = Date.now();
      activitySocket.serializeAttachment(attachment);
    }

    const participantId = this.participantIdFor(ws);
    if (!participantId) return;

    const room = await this.getRoom();
    const participant = room.participants[participantId];
    if (!participant) return;

    const wasFacilitator = participant.isFacilitator;
    delete room.participants[participantId];
    room.order = room.order.filter((id) => id !== participantId);

    if (Object.keys(room.participants).length === 0) {
      this.roomPromise = null;
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      return;
    }

    if (wasFacilitator) this.promoteNextFacilitator(room);
    await this.saveRoom(room);
    await this.broadcastState(room);
  }

  async alarm() {
    const webSockets = this.state.getWebSockets();
    const now = Date.now();
    const lastRoomActivityAt = webSockets.reduce((latest, ws) => {
      const attachment = this.connectionAttachment(ws);
      return Math.max(latest, attachment.lastActivityAt ?? 0);
    }, 0);

    if (webSockets.length === 0 || now - lastRoomActivityAt >= AFK_TIMEOUT_MS) {
      for (const ws of webSockets) {
        this.send(ws, { type: "error", message: AFK_TIMEOUT_MESSAGE });
        ws.close(1000, AFK_TIMEOUT_MESSAGE);
      }
      this.roomPromise = null;
      await this.deleteAlarms();
      await this.state.storage.deleteAll();
      return;
    }

    this.scheduleAfkCheck(lastRoomActivityAt + AFK_TIMEOUT_MS);
  }

  webSocketError(ws: WebSocket) {
    ws.close();
  }

  private connectionAttachment(ws: WebSocket): ConnectionAttachment {
    return ws.deserializeAttachment() as ConnectionAttachment;
  }
}
