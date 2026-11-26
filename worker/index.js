import { DurableObject } from "cloudflare:workers";

const ROOM_PREFIX = "room:";
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let result = "";
  for (const byte of bytes) result += ROOM_CODE_CHARS[byte % ROOM_CODE_CHARS.length];
  return result;
}

function cleanText(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  return cleaned.slice(0, maxLength) || fallback;
}

function corsHeaders(env) {
  const allowedOrigin = env.FRONTEND_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    capacity: room.capacity,
    privateRoom: room.privateRoom,
    hostId: room.hostId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.id === room.hostId,
    })),
    status: room.status,
    selectedGame: room.selectedGame,
    createdAt: room.createdAt,
  };
}

export class RoomHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
  }

  runExclusive(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return jsonResponse(this.env, { ok: true, service: "PLAYGROUND API" });
    }

    if (url.pathname === "/api/rooms" && request.method === "GET") {
      return this.listRooms();
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return this.createRoom(request);
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{8})(?:\/(ws))?$/i);
    if (roomMatch && request.method === "GET" && roomMatch[2] === "ws") {
      return this.connectWebSocket(request, roomMatch[1].toUpperCase());
    }

    if (roomMatch && request.method === "GET" && !roomMatch[2]) {
      const room = await this.ctx.storage.get(`${ROOM_PREFIX}${roomMatch[1].toUpperCase()}`);
      if (!room) return jsonResponse(this.env, { error: "Otaq tapılmadı." }, 404);
      return jsonResponse(this.env, { room: publicRoom(room) });
    }

    return jsonResponse(this.env, { error: "Endpoint tapılmadı." }, 404);
  }

  async listRooms() {
    const storedRooms = await this.ctx.storage.list({ prefix: ROOM_PREFIX });
    const rooms = [...storedRooms.values()]
      .filter((room) => !room.privateRoom && room.status === "waiting" && room.players.length < room.capacity)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map(publicRoom);
    return jsonResponse(this.env, { rooms });
  }

  async createRoom(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(this.env, { error: "Göndərilən məlumat oxunmadı." }, 400);
    }

    const name = cleanText(body?.name, 36);
    const hostName = cleanText(body?.hostName, 20, "Qonaq");
    const capacity = Number(body?.capacity);
    const allowedCapacities = [2, 4, 6, 8, 10];

    if (!name) return jsonResponse(this.env, { error: "Otağın adını yaz." }, 400);
    if (!allowedCapacities.includes(capacity)) {
      return jsonResponse(this.env, { error: "Oyunçu sayı düzgün deyil." }, 400);
    }

    const result = await this.runExclusive(async () => {
      let id = randomCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (!(await this.ctx.storage.get(`${ROOM_PREFIX}${id}`))) break;
        id = randomCode();
      }

      const playerId = crypto.randomUUID();
      const room = {
        id,
        name,
        capacity,
        privateRoom: Boolean(body?.privateRoom),
        hostId: playerId,
        players: [{ id: playerId, name: hostName, joinedAt: Date.now() }],
        status: "waiting",
        selectedGame: null,
        messages: [],
        createdAt: Date.now(),
      };

      await this.ctx.storage.put(`${ROOM_PREFIX}${id}`, room);
      return { room: publicRoom(room), playerId };
    });

    return jsonResponse(this.env, result, 201);
  }

  async connectWebSocket(request, roomId) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse(this.env, { error: "WebSocket bağlantısı tələb olunur." }, 426);
    }

    const url = new URL(request.url);
    const playerName = cleanText(url.searchParams.get("name"), 20, "Qonaq");
    const requestedPlayerId = cleanText(url.searchParams.get("playerId"), 64);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const joined = await this.runExclusive(async () => {
      const key = `${ROOM_PREFIX}${roomId}`;
      const room = await this.ctx.storage.get(key);
      if (!room) return { error: "Otaq tapılmadı.", status: 404 };

      let player = requestedPlayerId
        ? room.players.find((item) => item.id === requestedPlayerId)
        : null;

      if (!player && room.players.length >= room.capacity) {
        return { error: "Otaqda boş yer yoxdur.", status: 409 };
      }

      if (!player) {
        player = { id: crypto.randomUUID(), name: playerName, joinedAt: Date.now() };
        room.players.push(player);
      } else {
        player.name = playerName;
      }

      await this.ctx.storage.put(key, room);
      return { room, playerId: player.id };
    });

    if (joined.error) {
      return jsonResponse(this.env, { error: joined.error }, joined.status);
    }

    server.serializeAttachment({ roomId, playerId: joined.playerId });
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({
      type: "welcome",
      playerId: joined.playerId,
      room: publicRoom(joined.room),
      messages: joined.room.messages,
    }));
    this.broadcast(roomId, { type: "room_update", room: publicRoom(joined.room) });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, rawData) {
    if (typeof rawData !== "string") return;
    const connection = socket.deserializeAttachment();
    if (!connection) return;

    let message;
    try {
      message = JSON.parse(rawData);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Mesaj formatı düzgün deyil." }));
      return;
    }

    const result = await this.runExclusive(async () => {
      const key = `${ROOM_PREFIX}${connection.roomId}`;
      const room = await this.ctx.storage.get(key);
      if (!room) return { error: "Otaq artıq mövcud deyil." };

      const player = room.players.find((item) => item.id === connection.playerId);
      if (!player) return { error: "Oyunçu otaqda tapılmadı." };

      if (message.type === "chat") {
        const text = cleanText(message.text, 300);
        if (!text) return { error: "Boş mesaj göndərmək olmaz." };
        const chatMessage = {
          id: crypto.randomUUID(),
          playerId: player.id,
          playerName: player.name,
          text,
          createdAt: Date.now(),
        };
        room.messages.push(chatMessage);
        room.messages = room.messages.slice(-50);
        await this.ctx.storage.put(key, room);
        return { broadcast: { type: "chat", message: chatMessage } };
      }

      if (["start_game", "back_to_lobby", "close_room"].includes(message.type)) {
        if (player.id !== room.hostId) return { error: "Bu əməliyyatı yalnız otaq sahibi edə bilər." };

        if (message.type === "start_game") {
          const allowedGames = ["reaction-rush", "brain-battle", "draw-guess", "secret-role"];
          if (!allowedGames.includes(message.gameId)) return { error: "Oyun seçimi düzgün deyil." };
          room.status = "playing";
          room.selectedGame = message.gameId;
          await this.ctx.storage.put(key, room);
          return { broadcast: { type: "game_started", gameId: room.selectedGame, room: publicRoom(room) } };
        }

        if (message.type === "back_to_lobby") {
          room.status = "waiting";
          room.selectedGame = null;
          await this.ctx.storage.put(key, room);
          return { broadcast: { type: "room_update", room: publicRoom(room) } };
        }

        await this.ctx.storage.delete(key);
        return { closeRoom: true, roomId: connection.roomId };
      }

      return { error: "Naməlum əməliyyat." };
    });

    if (result.error) {
      socket.send(JSON.stringify({ type: "error", message: result.error }));
    } else if (result.closeRoom) {
      this.broadcast(result.roomId, { type: "room_closed" });
      this.closeRoomSockets(result.roomId);
    } else if (result.broadcast) {
      this.broadcast(connection.roomId, result.broadcast);
    }
  }

  async webSocketClose(socket, code, reason) {
    await this.removeConnection(socket);
    if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) {
      socket.close(code, reason);
    } else {
      socket.close();
    }
  }

  async webSocketError(socket) {
    await this.removeConnection(socket);
  }

  async removeConnection(socket) {
    const connection = socket.deserializeAttachment();
    if (!connection) return;

    const result = await this.runExclusive(async () => {
      const key = `${ROOM_PREFIX}${connection.roomId}`;
      const room = await this.ctx.storage.get(key);
      if (!room) return { deleted: true };

      room.players = room.players.filter((player) => player.id !== connection.playerId);
      if (room.players.length === 0) {
        await this.ctx.storage.delete(key);
        return { deleted: true };
      }

      if (room.hostId === connection.playerId) room.hostId = room.players[0].id;
      await this.ctx.storage.put(key, room);
      return { room };
    });

    if (result.deleted) {
      this.broadcast(connection.roomId, { type: "room_closed" });
    } else {
      this.broadcast(connection.roomId, { type: "room_update", room: publicRoom(result.room) });
    }
  }

  broadcast(roomId, payload) {
    const serialized = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      const connection = socket.deserializeAttachment();
      if (connection?.roomId === roomId) {
        try {
          socket.send(serialized);
        } catch {
          // Ignore sockets which are already closing.
        }
      }
    }
  }

  closeRoomSockets(roomId) {
    for (const socket of this.ctx.getWebSockets()) {
      const connection = socket.deserializeAttachment();
      if (connection?.roomId === roomId) {
        try {
          socket.close(1000, "Room closed");
        } catch {
          // Ignore sockets which are already closing.
        }
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowedOrigin = env.FRONTEND_ORIGIN || "*";

    if (allowedOrigin !== "*" && origin && origin !== allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin icazəli deyil." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (!url.pathname.startsWith("/api/")) {
      return new Response("PLAYGROUND API is running", { status: 200 });
    }

    const id = env.ROOM_HUB.idFromName("playground-global-room-hub");
    const hub = env.ROOM_HUB.get(id);
    return hub.fetch(request);
  },
};
