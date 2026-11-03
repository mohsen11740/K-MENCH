const BASE = 'https://k-mench-server.mohsen11740.workers.dev';
const fail = (message) => { throw new Error(message); };

class Peer {
  constructor(url) {
    this.messages = [];
    this.waiters = [];
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      const index = this.waiters.findIndex((waiter) => waiter.predicate(data));
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(data);
      else this.messages.push(data);
    });
  }
  async waitFor(predicate, timeoutMs = 10000) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return this.messages.splice(index, 1)[0];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== done);
        reject(new Error('Timed out waiting for room event'));
      }, timeoutMs);
      const done = (value) => { clearTimeout(timer); resolve(value); };
      this.waiters.push({ predicate, resolve: done });
    });
  }
  send(data) { this.ws.send(JSON.stringify(data)); }
  close() { try { this.ws.close(); } catch {} }
}

const response = await fetch(`${BASE}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'CI میزبان' }),
});
const created = await response.json();
if (!response.ok || !created.ok || !/^[A-HJ-NP-Z2-9]{6}$/.test(created.code)) fail('Room creation failed: ' + JSON.stringify(created));

const url = (name) => `${BASE.replace('https:', 'wss:')}/api/rooms/${created.code}/connect?name=${encodeURIComponent(name)}`;
const host = new Peer(url('بازیکن اول'));
await host.opened;
const guest = new Peer(url('بازیکن دوم'));
try {
  await Promise.all([host.opened, guest.opened]);
  const [hostWelcome, guestWelcome] = await Promise.all([
    host.waitFor((m) => m.type === 'welcome'),
    guest.waitFor((m) => m.type === 'welcome'),
  ]);
  if (hostWelcome.seat !== 0 || guestWelcome.seat !== 1) fail('Player seats are not assigned correctly');
  if (hostWelcome.room.players.length !== 1 || guestWelcome.room.players.length !== 2) fail('Room membership did not synchronize');

  host.send({ type: 'rename', name: 'میزبان ویرایش‌شده' });
  const renamed = await guest.waitFor((m) => m.type === 'presence' && m.room.players.some((p) => p.name === 'میزبان ویرایش‌شده'));
  if (!renamed.room.players.some((p) => p.name === 'میزبان ویرایش‌شده')) fail('Online player rename did not synchronize');

  const hostMusic = host.waitFor((m) => m.type === 'music' && m.playing);
  const guestMusic = guest.waitFor((m) => m.type === 'music' && m.playing);
  host.send({ type: 'music', url: 'https://example.com/test-track.mp3', playing: true });
  const [musicA, musicB] = await Promise.all([hostMusic, guestMusic]);
  if (!musicA.startedAt || musicA.startedAt !== musicB.startedAt || musicA.url !== musicB.url) fail('Music state did not synchronize');

  host.send({ type: 'start', teamMode: true, teamName: 'تیم آزمایشی' });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const waiting = await fetch(`${BASE}/api/rooms/${created.code}/status`).then((r) => r.json());
  if (waiting.room.status !== 'waiting') fail('Two-player team room started without all four players');

  const hostStarted = host.waitFor((m) => m.type === 'state' && m.room.status === 'playing');
  const guestStarted = guest.waitFor((m) => m.type === 'state' && m.room.status === 'playing');
  host.send({ type: 'start', league: 'دوستانه', teamMode: false });
  let [state, guestState] = await Promise.all([hostStarted, guestStarted]);
  if (state.room.players.filter((p) => p.connected).length !== 2) fail('Both players are not connected at game start');

  let moved = false;
  let movedSeat = null;
  for (let attempt = 0; attempt < 60 && !moved; attempt++) {
    const seat = state.room.currentTurn;
    const active = seat === 0 ? host : guest;
    const other = seat === 0 ? guest : host;
    const predicate = (m) => m.type === 'state' && ['roll', 'skip'].includes(m.lastAction?.type) && m.lastAction.seat === seat;
    const activeResult = active.waitFor(predicate);
    const otherResult = other.waitFor(predicate);
    active.send({ type: 'roll' });
    const [a, b] = await Promise.all([activeResult, otherResult]);
    state = a;
    guestState = b;
    if (a.lastAction.type === 'roll' && a.lastAction.value === 6) {
      const movedHost = host.waitFor((m) => m.type === 'state' && m.lastAction?.type === 'move' && m.lastAction.seat === seat);
      const movedGuest = guest.waitFor((m) => m.type === 'state' && m.lastAction?.type === 'move' && m.lastAction.seat === seat);
      active.send({ type: 'move', token: 0 });
      const [h, g] = await Promise.all([movedHost, movedGuest]);
      if (h.room.tokens[seat][0] !== 0 || g.room.tokens[seat][0] !== 0) fail('Moved token did not synchronize to both players');
      if (JSON.stringify(h.room.tokens) !== JSON.stringify(g.room.tokens)) fail('Players received different game states');
      state = h;
      movedSeat = seat;
      moved = true;
    }
  }
  if (!moved) fail('No six was rolled within the smoke-test limit');
  console.log(JSON.stringify({
    ok: true,
    test: 'two-player-online-room',
    room: created.code,
    seats: [hostWelcome.seat, guestWelcome.seat],
    started: state.room.status === 'playing',
    synchronizedMove: true,
    synchronizedRename: true,
    synchronizedMusicClock: true,
    teamRequiresFourPlayers: true,
    movedSeat,
    tokenProgress: state.room.tokens[movedSeat][0],
  }));
} finally {
  host.close();
  guest.close();
}
