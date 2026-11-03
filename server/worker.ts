import { DurableObject } from "cloudflare:workers";

type Player = { id: string; name: string; seat: number; connected: boolean };
type Room = { code: string; status: "waiting" | "playing" | "finished"; players: Player[]; currentTurn: number; dice: number | null; tokens: number[][]; createdAt: number; updatedAt: number };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
function makeCode() { const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => chars[n % chars.length]).join(""); }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } });
    if (url.pathname === "/health") return json({ ok: true, service: "k-mench-server", realtime: "durable-objects" });
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await request.json().catch(() => ({})) as { name?: string };
      const code = makeCode();
      const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
      const response = await stub.fetch("https://room.internal/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: (body.name || "بازیکن میزبان").slice(0, 24) }) });
      return json(await response.json(), response.status);
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/connect$/i);
    if (match) {
      const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(match[1].toUpperCase()));
      const target = new URL("/connect?" + url.searchParams.toString(), "https://room.internal");
      return stub.fetch(new Request(target, request));
    }
    return json({ ok: false, error: "مسیر پیدا نشد." }, 404);
  },
};

export interface Env { GAME_ROOMS: DurableObjectNamespace<GameRoom> }

export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private async load(): Promise<Room | null> { if (!this.room) this.room = await this.ctx.storage.get<Room>("room") ?? null; return this.room; }
  private async save() { if (this.room) { this.room.updatedAt = Date.now(); await this.ctx.storage.put("room", this.room); } }
  private broadcast(payload: unknown) { const message = JSON.stringify(payload); for (const socket of this.ctx.getWebSockets()) { try { socket.send(message); } catch {} } }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") {
      const data = await request.json() as { code: string; name: string };
      if (await this.load()) return json({ ok: false, error: "این کد قبلاً استفاده شده است." }, 409);
      this.room = { code: data.code, status: "waiting", players: [{ id: crypto.randomUUID(), name: data.name, seat: 0, connected: false }], currentTurn: 0, dice: null, tokens: Array.from({ length: 4 }, () => Array(4).fill(-1)), createdAt: Date.now(), updatedAt: Date.now() };
      await this.save();
      return json({ ok: true, code: data.code, playerId: this.room.players[0].id, maxPlayers: 4 });
    }
    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ ok: false, error: "اتصال WebSocket لازم است." }, 426);
      const room = await this.load();
      if (!room) return json({ ok: false, error: "اتاق بازی پیدا نشد." }, 404);
      const name = (url.searchParams.get("name") || "بازیکن").slice(0, 24);
      const playerId = url.searchParams.get("playerId");
      let player = playerId ? room.players.find(p => p.id === playerId) : undefined;
      if (!player) {
        player = room.players.find(p => !p.connected);
        if (!player && room.players.length < 4) { player = { id: crypto.randomUUID(), name, seat: room.players.length, connected: false }; room.players.push(player); }
      }
      if (!player) return json({ ok: false, error: "ظرفیت این اتاق تکمیل است." }, 409);
      player.name = name || player.name; player.connected = true; await this.save();
      const pair = new WebSocketPair(); const client = pair[0]; const server = pair[1];
      this.ctx.acceptWebSocket(server); server.serializeAttachment({ playerId: player.id });
      server.send(JSON.stringify({ type: "welcome", playerId: player.id, seat: player.seat, room }));
      this.broadcast({ type: "presence", room });
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ ok: false, error: "مسیر پیدا نشد." }, 404);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const room = await this.load(); if (!room) return;
    let data: { type?: string; token?: number } = {};
    try { data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); } catch { return; }
    const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
    const player = room.players.find(p => p.id === attachment?.playerId); if (!player) return;
    if (data.type === "start") {
      if (player.seat !== 0 || room.players.length < 2 || room.status !== "waiting") return;
      room.status = "playing"; await this.save(); this.broadcast({ type: "state", room }); return;
    }
    if (data.type === "roll") {
      if (room.status !== "playing" || player.seat !== room.currentTurn || room.dice !== null) return;
      room.dice = crypto.getRandomValues(new Uint32Array(1))[0] % 6 + 1;
      await this.save(); this.broadcast({ type: "state", room, lastAction: { type: "roll", seat: player.seat, value: room.dice } }); return;
    }
    if (data.type === "move") {
      const value = room.dice; const token = Number(data.token);
      if (room.status !== "playing" || player.seat !== room.currentTurn || value === null || !Number.isInteger(token) || token < 0 || token > 3) return;
      const old = room.tokens[player.seat][token]; const next = old < 0 ? (value === 6 ? 0 : -1) : old + value <= 57 ? old + value : old;
      if (next < 0 || next === old) return;
      room.tokens[player.seat][token] = next; room.dice = null;
      if (room.tokens[player.seat].every(p => p === 57)) room.status = "finished";
      else if (value !== 6) room.currentTurn = (room.currentTurn + 1) % room.players.length;
      await this.save(); this.broadcast({ type: "state", room, lastAction: { type: "move", seat: player.seat, token, progress: next } });
    }
  }

  async webSocketClose(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
    const room = await this.load(); if (!room) return;
    const player = room.players.find(p => p.id === attachment?.playerId);
    if (player) player.connected = false;
    await this.save(); this.broadcast({ type: "presence", room });
  }
}
