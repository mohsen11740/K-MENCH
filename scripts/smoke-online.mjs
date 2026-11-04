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
let guest = new Peer(url('بازیکن دوم'));
try {
  await Promise.all([host.opened, guest.opened]);
  const hostWelcome = await host.waitFor((m) => m.type === 'welcome');
  const guestPending = await guest.waitFor((m) => m.type === 'join-pending');
  const guestRequest = await host.waitFor((m) => m.type === 'join-request');
  if (guestPending.role !== 'player' || guestRequest.request.name !== 'بازیکن دوم') fail('Guest was not held for host approval');
  const approvedGuest = host.waitFor((m) => m.type === 'presence' && m.room.players.length === 2);
  host.send({ type: 'join-decision', requestId: guestRequest.request.requestId, allow: true });
  const guestWelcome = await guest.waitFor((m) => m.type === 'welcome');
  await approvedGuest;
  if (hostWelcome.seat !== 0 || guestWelcome.seat !== 1) fail('Player seats are not assigned correctly');
  if (hostWelcome.room.players.length !== 1 || guestWelcome.room.players.length !== 2) fail('Room membership did not synchronize');

  const disconnectedPresence = host.waitFor((m) => m.type === 'presence' && m.room.players.some((p) => p.seat === 1 && !p.connected));
  guest.close();
  await disconnectedPresence;
  const reconnectedGuest = new Peer(`${BASE.replace('https:', 'wss:')}/api/rooms/${created.code}/connect?name=${encodeURIComponent('بازیکن دوم')}&playerId=${encodeURIComponent(guestWelcome.playerId)}`);
  await reconnectedGuest.opened;
  const reconnectedWelcome = await reconnectedGuest.waitFor((m) => m.type === 'welcome');
  if (reconnectedWelcome.seat !== 1 || !reconnectedWelcome.room.players.some((p) => p.seat === 1 && p.connected)) fail('Player reconnect did not restore the original seat');
  guest = reconnectedGuest;

  host.send({ type: 'rename', name: 'میزبان ویرایش‌شده' });
  const renamed = await guest.waitFor((m) => m.type === 'presence' && m.room.players.some((p) => p.name === 'میزبان ویرایش‌شده'));
  if (!renamed.room.players.some((p) => p.name === 'میزبان ویرایش‌شده')) fail('Online player rename did not synchronize');

  const hostChat = host.waitFor((m) => m.type === 'chat' && m.message.text === 'پیام آزمایشی');
  const guestChat = guest.waitFor((m) => m.type === 'chat' && m.message.text === 'پیام آزمایشی');
  host.send({ type: 'chat', message: { text: 'پیام آزمایشی' } });
  await Promise.all([hostChat, guestChat]);

  const voicePayload = 'data:audio/webm;base64,dGVzdA==';
  const hostVoice = host.waitFor((m) => m.type === 'voice' && m.message.audio === voicePayload);
  const guestVoice = guest.waitFor((m) => m.type === 'voice' && m.message.audio === voicePayload);
  host.send({ type: 'voice', message: { text: 'پیام صوتی', audio: voicePayload } });
  await Promise.all([hostVoice, guestVoice]);

  const hostMusic = host.waitFor((m) => m.type === 'music' && m.playing);
  const guestMusic = guest.waitFor((m) => m.type === 'music' && m.playing);
  host.send({ type: 'music', url: 'https://example.com/test-track.mp3', playing: true });
  const [musicA, musicB] = await Promise.all([hostMusic, guestMusic]);
  if (!musicA.startedAt || musicA.startedAt !== musicB.startedAt || musicA.url !== musicB.url) fail('Music state did not synchronize');
  const hostConsent = host.waitFor((m) => m.type === 'music-consent' && m.seat === 1 && m.allowed === true);
  guest.send({ type: 'music-consent', allowed: true });
  const consentState = await hostConsent;
  if (consentState.consent['1'] !== true) fail('Guest music consent was not recorded');
  const hostStop = host.waitFor((m) => m.type === 'music' && !m.playing);
  host.send({ type: 'music', url: 'https://example.com/test-track.mp3', playing: false });
  await hostStop;

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
      if (!h.room.history?.length || (h.room.stats?.[String(seat)]?.moves || 0) < 1) fail('Move history or player statistics were not recorded');
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
    automaticReconnect: true,
    synchronizedChat: true,
    synchronizedVoicePayload: true,
    synchronizedMusicClock: true,
    perPlayerMusicConsent: true,
    hostApprovedPlayerAdmission: true,
    sharedMoveHistoryAndStats: true,
    teamRequiresFourPlayers: true,
    movedSeat,
    tokenProgress: state.room.tokens[movedSeat][0],
  }));
} finally {
  host.close();
  guest.close();
}


const teamCreatedResponse = await fetch(`${BASE}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'میزبان لیگ تیمی' }),
});
const teamCreated = await teamCreatedResponse.json();
if (!teamCreatedResponse.ok || !teamCreated.ok) fail('Team room creation failed');
const teamPeers = [];
try {
  for (let seat = 0; seat < 4; seat++) {
    const peer = new Peer(`${BASE.replace('https:', 'wss:')}/api/rooms/${teamCreated.code}/connect?name=${encodeURIComponent('عضو تیم ' + (seat + 1))}`);
    teamPeers.push(peer);
    await peer.opened;
    let welcome;
    if (seat === 0) welcome = await peer.waitFor((m) => m.type === 'welcome');
    else {
      await peer.waitFor((m) => m.type === 'join-pending');
      const request = await teamPeers[0].waitFor((m) => m.type === 'join-request' && m.request.name === 'عضو تیم ' + (seat + 1));
      teamPeers[0].send({ type: 'join-decision', requestId: request.request.requestId, allow: true });
      welcome = await peer.waitFor((m) => m.type === 'welcome');
    }
    if (welcome.seat !== seat) fail('Team player seat assignment failed');
  }
  const startedEvents = teamPeers.map((peer) => peer.waitFor((m) => m.type === 'state' && m.room.status === 'playing'));
  teamPeers[0].send({ type: 'start', teamMode: true, teamName: 'تیم باران', league: 'جام باران' });
  const teamStates = await Promise.all(startedEvents);
  if (!teamStates.every((event) => event.room.teamMode && event.room.teamName === 'تیم باران' && event.room.league === 'جام باران')) {
    fail('Four-player team and league settings did not synchronize');
  }
  console.log(JSON.stringify({ ok: true, test: 'four-player-team-league', room: teamCreated.code, teamMode: true, league: 'جام باران' }));
} finally {
  teamPeers.forEach((peer) => peer.close());
}


const gateRoomResponse = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'میزبان کنترل ورود' }) });
const gateRoom = await gateRoomResponse.json();
const gateHost = new Peer(`${BASE.replace('https:', 'wss:')}/api/rooms/${gateRoom.code}/connect?name=میزبان`);
const gateDenied = new Peer(`${BASE.replace('https:', 'wss:')}/api/rooms/${gateRoom.code}/connect?name=مهمان-ردشده`);
const gatePlayer = new Peer(`${BASE.replace('https:', 'wss:')}/api/rooms/${gateRoom.code}/connect?name=بازیکن-مجاز`);
let gateSpectator;
try {
  await gateHost.opened;
  await gateHost.waitFor(m => m.type === 'welcome');
  await gateDenied.opened;
  await gateDenied.waitFor(m => m.type === 'join-pending');
  const deniedRequest = await gateHost.waitFor(m => m.type === 'join-request' && m.request.name === 'مهمان-ردشده');
  gateHost.send({ type: 'join-decision', requestId: deniedRequest.request.requestId, allow: false });
  await gateDenied.waitFor(m => m.type === 'join-denied');

  await gatePlayer.opened;
  await gatePlayer.waitFor(m => m.type === 'join-pending');
  const playerRequest = await gateHost.waitFor(m => m.type === 'join-request' && m.request.name === 'بازیکن-مجاز');
  gateHost.send({ type: 'join-decision', requestId: playerRequest.request.requestId, allow: true });
  const admitted = await gatePlayer.waitFor(m => m.type === 'welcome');
  if (admitted.seat !== 1) fail('Approved guest did not receive the next player seat');

  const hostStarted = gateHost.waitFor(m => m.type === 'state' && m.room.status === 'playing');
  gateHost.send({ type: 'start', teamMode: false, league: 'آزمایش پذیرش' });
  await hostStarted;
  gateSpectator = new Peer(`${BASE.replace('https:', 'wss:')}/api/rooms/${gateRoom.code}/connect?name=تماشاگر&role=spectator`);
  await gateSpectator.opened;
  await gateSpectator.waitFor(m => m.type === 'join-pending');
  const spectatorRequest = await gateHost.waitFor(m => m.type === 'join-request' && m.request.role === 'spectator');
  gateHost.send({ type: 'join-decision', requestId: spectatorRequest.request.requestId, allow: true });
  const spectatorWelcome = await gateSpectator.waitFor(m => m.type === 'welcome');
  if (!spectatorWelcome.spectator || spectatorWelcome.seat !== null) fail('Approved spectator received a player seat');
  console.log(JSON.stringify({ ok: true, test: 'host-admission-and-spectator-gate', approvedPlayer: true, rejectedGuestBlocked: true, activeMatchSpectator: true }));
} finally { gateHost.close(); gateDenied.close(); gatePlayer.close(); gateSpectator?.close(); }
