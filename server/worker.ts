import { DurableObject } from "cloudflare:workers";

type Player = { id: string; name: string; seat: number; connected: boolean; lastSeen: number };
type Room = { code: string; status: "waiting" | "playing" | "finished"; hostId: string | null; players: Player[]; currentTurn: number; dice: number | null; tokens: number[][]; createdAt: number; updatedAt: number };
const headers = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
function makeCode() { const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => chars[n % chars.length]).join(""); }
function cleanName(value: unknown) { return typeof value === "string" ? value.trim().replace(/[<>]/g, "").slice(0, 24) || "بازیکن" : "بازیکن"; }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: { ...headers, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } });
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "k-mench-server", version: "1.0.0", realtime: "durable-objects", game: "K-MENCH" });
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await request.json().catch(() => ({})) as { name?: string };
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = makeCode();
        const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
        const response = await stub.fetch("https://room.internal/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: cleanName(body.name) }) });
        if (response.status !== 409) return new Response(await response.text(), { status: response.status, headers });
      }
      return json({ ok: false, error: "ساخت اتاق ممکن نشد؛ دوباره تلاش کنید." }, 503);
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(connect|status))?$/i);
    if (match) {
      const code = match[1].toUpperCase();
      const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
      if (match[2] === "status" || (!match[2] && request.method === "GET")) return stub.fetch("https://room.internal/status");
      if (match[2] === "connect") {
        const target = new URL("/connect?" + url.searchParams.toString(), "https://room.internal");
        return stub.fetch(new Request(target, request));
      }
    }
    return json({ ok: false, error: "مسیر پیدا نشد." }, 404);
  },
};

export interface Env { GAME_ROOMS: DurableObjectNamespace<GameRoom> }

export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private async load(): Promise<Room | null> { if (!this.room) this.room = await this.ctx.storage.get<Room>("room") ?? null; return this.room; }
  private async save() { if (this.room) { this.room.updatedAt = Date.now(); await this.ctx.storage.put("room", this.room); } }
  private publicRoom(room: Room) { return { ...room, players: room.players.map(({ id, ...p }) => ({ ...p })) }; }
  private broadcast(payload: unknown) { const message = JSON.stringify(payload); for (const socket of this.ctx.getWebSockets()) { try { socket.send(message); } catch {} } }
  private state() { if (!this.room) return null; return this.publicRoom(this.room); }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") {
      const data = await request.json() as { code: string; name: string };
      if (await this.load()) return json({ ok: false, error: "این کد قبلاً استفاده شده است." }, 409);
      this.room = { code: data.code, status: "waiting", hostId: null, players: [], currentTurn: 0, dice: null, tokens: Array.from({ length: 4 }, () => Array(4).fill(-1)), createdAt: Date.now(), updatedAt: Date.now() };
      await this.save();
      return json({ ok: true, code: data.code, maxPlayers: 4, status: "waiting" });
    }
    if (url.pathname === "/status") {
      const room = await this.load();
      return room ? json({ ok: true, room: this.publicRoom(room) }) : json({ ok: false, error: "اتاق بازی پیدا نشد." }, 404);
    }
    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ ok: false, error: "اتصال زنده WebSocket لازم است." }, 426);
      const room = await this.load();
      if (!room) return json({ ok: false, error: "اتاق بازی پیدا نشد." }, 404);
      const name = cleanName(url.searchParams.get("name"));
      const playerId = url.searchParams.get("playerId");
      let player = playerId ? room.players.find(p => p.id === playerId) : undefined;
      if (!player) {
        if (room.status !== "waiting") return json({ ok: false, error: "بازی شروع شده و ورود بازیکن جدید بسته است." }, 409);
        const used = new Set(room.players.map(p => p.seat));
        const seat = [0, 1, 2, 3].find(n => !used.has(n));
        if (seat === undefined) return json({ ok: false, error: "ظرفیت این اتاق تکمیل است." }, 409);
        player = { id: crypto.randomUUID(), name, seat, connected: false, lastSeen: Date.now() };
        room.players.push(player);
        if (seat === 0) room.hostId = player.id;
      }
      player.name = name; player.connected = true; player.lastSeen = Date.now();
      await this.save();
      const pair = new WebSocketPair(); const client = pair[0]; const server = pair[1];
      this.ctx.acceptWebSocket(server); server.serializeAttachment({ playerId: player.id });
      server.send(JSON.stringify({ type: "welcome", playerId: player.id, seat: player.seat, room: this.publicRoom(room) }));
      this.broadcast({ type: "presence", room: this.publicRoom(room) });
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
      if (player.id !== room.hostId || room.players.length < 2 || room.status !== "waiting") return;
      room.status = "playing"; room.currentTurn = 0; await this.save(); this.broadcast({ type: "state", room: this.publicRoom(room) }); return;
    }
    if (data.type === "roll") {
      if (room.status !== "playing" || player.seat !== room.currentTurn || room.dice !== null) return;
      room.dice = crypto.getRandomValues(new Uint32Array(1))[0] % 6 + 1;
      await this.save(); this.broadcast({ type: "state", room: this.publicRoom(room), lastAction: { type: "roll", seat: player.seat, value: room.dice } }); return;
    }
    if (data.type === "move") {
      const value = room.dice; const token = Number(data.token);
      if (room.status !== "playing" || player.seat !== room.currentTurn || value === null || !Number.isInteger(token) || token < 0 || token > 3) return;
      const old = room.tokens[player.seat][token];
      if (old < 0 && value !== 6) return;
      const next = old < 0 ? 0 : old + value;
      if (next > 57 || next === old) return;
      room.tokens[player.seat][token] = next;
      let captured = false;
      const starts = [0, 13, 26, 39]; const safe = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
      const global = (starts[player.seat] + next) % 52;
      if (next < 51 && !safe.has(global)) {
        for (let seat = 0; seat < 4; seat++) if (seat !== player.seat) for (let i = 0; i < 4; i++) {
          const progress = room.tokens[seat][i];
          if (progress >= 0 && progress < 51 && (starts[seat] + progress) % 52 === global) { room.tokens[seat][i] = -1; captured = true; }
        }
      }
      room.dice = null;
      if (room.tokens[player.seat].every(p => p === 57)) room.status = "finished";
      else if (value !== 6 && !captured) room.currentTurn = (room.currentTurn + 1) % room.players.length;
      await this.save(); this.broadcast({ type: "state", room: this.publicRoom(room), lastAction: { type: "move", seat: player.seat, token, progress: next, captured } });
    }
  }

  async webSocketClose(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as { playerId?: string } | null;
    const room = await this.load(); if (!room) return;
    const player = room.players.find(p => p.id === attachment?.playerId);
    if (player) { player.connected = false; player.lastSeen = Date.now(); }
    await this.save(); this.broadcast({ type: "presence", room: this.publicRoom(room) });
  }
}
