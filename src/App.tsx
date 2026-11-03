import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Crown, Dice5, Gamepad2, Medal, MessageCircle, Plus, RotateCcw, Share2, Sparkles, Users } from 'lucide-react'

type Player = { id: number; name: string; color: string; human: boolean; start: number }
type Token = { progress: number }
const COLORS = ['#d95d50', '#e6b94f', '#4e9c78', '#568bc4']
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47])
const TRACK: [number, number][] = [
  [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
  [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],
  [8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],
  [13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0]
]
const LANES: [number, number][][] = [
  [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
  [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],
  [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
  [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
]
const BASES: [number, number][][] = [
  [[1,1],[4,1],[1,4],[4,4]],
  [[10,1],[13,1],[10,4],[13,4]],
  [[10,10],[13,10],[10,13],[13,13]],
  [[1,10],[4,10],[1,13],[4,13]],
]
const STARTS = [0, 13, 26, 39]
const names = ['قرمز', 'زرد', 'سبز', 'آبی']
const IRANIAN_THEMES = [{id:'turquoise',name:'کاشی فیروزه‌ای',symbol:'✦'},{id:'miniature',name:'مینیاتور ایرانی',symbol:'❀'},{id:'isfahan',name:'فرش اصفهان',symbol:'✺'},{id:'dome',name:'گنبد فیروزه‌ای',symbol:'☼'},{id:'persepolis',name:'تخت جمشید',symbol:'𓃭'},{id:'paisley',name:'بته‌جقه',symbol:'❧'},{id:'garden',name:'باغ ایرانی',symbol:'❀'},{id:'khatam',name:'خاتم‌کاری',symbol:'✧'},{id:'pottery',name:'سفال ایرانی',symbol:'◉'},{id:'shahnameh',name:'شاهنامه',symbol:'⚔'}]
const DICE_STYLES = [{id:'classic',name:'کلاسیک'},{id:'gold',name:'طلایی'},{id:'turquoise',name:'فیروزه‌ای'},{id:'ruby',name:'یاقوتی'},{id:'wood',name:'چوبی'},{id:'marble',name:'مرمری'},{id:'neon',name:'نئونی'},{id:'royal',name:'شاهانه'},{id:'persian',name:'ایرانی'},{id:'midnight',name:'شب'}]
const freshTokens = (): Token[][] => Array.from({length:4}, () => Array.from({length:4}, () => ({progress:-1})))
function DiceCube({ value, rolling }: { value: number | null; rolling: boolean }) {
  const faces = ['⚀','⚁','⚂','⚃','⚄','⚅']
  return <div className={`dice-cube-stage ${rolling ? 'is-rolling' : ''}`} aria-label={value ? `تاس روی عدد ${value}` : 'تاس'}>
    <div className="dice-cube">
      <div className="cube-face cube-front">⚂</div><div className="cube-face cube-back">⚄</div><div className="cube-face cube-right">⚅</div><div className="cube-face cube-left">⚁</div>
      <div className="cube-face cube-top">{faces[(value || 1)-1]}</div><div className="cube-face cube-bottom">⚃</div>
    </div>
  </div>
}
function App() {
  const [humanCount, setHumanCount] = useState(1)
  const [localPlayerName, setLocalPlayerName] = useState(localStorage.getItem('k-mench-player-name') || 'باران')
  const [playerNames, setPlayerNames] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem('k-mench-player-names') || '[]'); return [localStorage.getItem('k-mench-player-name') || 'باران', ...Array.from({length:3},(_,i)=>saved[i+1] || `بازیکن ${i+2}`)] } catch { return ['باران','بازیکن ۲','بازیکن ۳','بازیکن ۴'] } })
  const [themeId, setThemeId] = useState('turquoise')
  const [diceStyle, setDiceStyle] = useState('classic')
  const [players, setPlayers] = useState<Player[]>([])
  const [tokens, setTokens] = useState<Token[][]>(freshTokens)
  const [turn, setTurn] = useState(0)
  const [dice, setDice] = useState<number|null>(null)
  const [rolling, setRolling] = useState(false)
  const [message, setMessage] = useState('برای شروع، تاس بیندازید.')
  const [winner, setWinner] = useState<number|null>(null)
  const [gameStarted, setGameStarted] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [onlineRoom, setOnlineRoom] = useState<any>(null)
  const [onlineSeat, setOnlineSeat] = useState<number|null>(null)
  const [onlineSocket, setOnlineSocket] = useState<WebSocket|null>(null)
  const [onlineError, setOnlineError] = useState('')
  const [joinRequests, setJoinRequests] = useState<{requestId:string;name:string;role:'player'|'spectator'}[]>([])
  const [isSpectator, setIsSpectator] = useState(false)
  const [moveHistory, setMoveHistory] = useState<{name:string;detail:string;time:string}[]>([])
  const [soundEnabled, setSoundEnabled] = useState(()=>localStorage.getItem('k-mench-sound') !== 'off')
  const [localStats, setLocalStats] = useState<Record<string,{wins:number;losses:number;captures:number;completed:number;moves:number}>>({})
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectEnabledRef = useRef(true)
  const [chatMessages, setChatMessages] = useState<{name:string;text:string;time:string;kind?:string;audio?:string}[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [league, setLeague] = useState('دوستانه')
  const [teamMode, setTeamMode] = useState(false)
  const [teamName, setTeamName] = useState('تیم باران')
  const [musicUrl, setMusicUrl] = useState('')
  const [musicActive, setMusicActive] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const musicAudioRef = useRef<HTMLAudioElement | null>(null)
  const onlineSeatRef = useRef<number | null>(null)
  const [musicStartedAt, setMusicStartedAt] = useState<number | null>(null)
  const [musicConsent, setMusicConsent] = useState<Record<string, boolean>>({})
  const [musicAllowed, setMusicAllowed] = useState(false)
  const [leagueScores, setLeagueScores] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem('k-mench-league-scores') || '{}') } catch { return {} } })

  const renamePlayer = (seat: number, value: string) => {
    const clean = value.replace(/[<>]/g, '').slice(0, 24)
    setPlayers(current => current.map(player => player.id === seat ? { ...player, name: clean } : player))
    if (onlineSocket && onlineSeat === seat) onlineSocket.send(JSON.stringify({ type: 'rename', name: clean }))
    if (!onlineSocket && seat === 0) setLocalPlayerName(clean)
    if (!onlineSocket) setPlayerNames(current => current.map((name, index) => index === seat ? clean : name))
  }
  const savePlayerName = (seat: number) => {
    const current = players[seat]?.name?.trim()
    if (!current) return
    if (seat === 0 || (onlineSocket && seat === onlineSeat)) localStorage.setItem('k-mench-player-name', current)
    const saved = players.map((player, index) => index === seat ? current : player.name)
    localStorage.setItem('k-mench-player-names', JSON.stringify(saved))
  }
  function sendChat() {
    const text = chatDraft.trim().slice(0, 500)
    if (!text) return
    const message = { name: players[onlineSeat ?? turn]?.name || localPlayerName, text, time: new Date().toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}) }
    if (onlineSocket?.readyState === WebSocket.OPEN) onlineSocket.send(JSON.stringify({type:'chat',message}))
    else setChatMessages(old=>[...old.slice(-49),message])
    setChatDraft('')
  }
  async function toggleVoice() {
    if (recording) { recorderRef.current?.stop(); setRecording(false); return }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setOnlineError('ضبط صدا در این مرورگر پشتیبانی نمی‌شود.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true})
      const recorder = new MediaRecorder(stream); recorderRef.current = recorder
      const chunks: BlobPart[] = []
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(t=>t.stop())
        const blob = new Blob(chunks,{type:recorder.mimeType || 'audio/webm'})
        if (blob.size > 900000) { setOnlineError('ویس طولانی است؛ لطفاً کوتاه‌تر ضبط کنید.'); return }
        const reader = new FileReader()
        reader.onload = () => {
          const message = {name:players[onlineSeat ?? turn]?.name || localPlayerName,text:'پیام صوتی',time:new Date().toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}),kind:'voice',audio:String(reader.result)}
          if(onlineSocket?.readyState===WebSocket.OPEN) onlineSocket.send(JSON.stringify({type:'voice',message}))
          else setChatMessages(old=>[...old.slice(-19),message])
        }
        reader.readAsDataURL(blob)
      }
      recorder.start(); setRecording(true)
    } catch { setOnlineError('برای ارسال ویس باید اجازه دسترسی به میکروفن بدهید.') }
  }
  function setSharedMusic(playing:boolean) {
    const startedAt = playing ? Date.now() : null
    setMusicActive(playing); setMusicStartedAt(startedAt); setMusicAllowed(!onlineSocket || onlineSeat === 0)
    if(onlineSocket?.readyState===WebSocket.OPEN) onlineSocket.send(JSON.stringify({type:'music',url:musicUrl,playing,startedAt}))
  }
  function answerMusicConsent(allowed:boolean) {
    setMusicAllowed(allowed)
    if(onlineSocket?.readyState===WebSocket.OPEN) onlineSocket.send(JSON.stringify({type:'music-consent',allowed}))
  }
  const makePlayers = (count: number): Player[] => names.map((name, id) => ({
    id, name: id < count ? (playerNames[id]?.trim() || `بازیکن ${id+1}`) : `هوش مصنوعی ${id+1-count}`,
    color: COLORS[id], human: id < count, start: STARTS[id],
  }))
  const applyOnlineRoom = (room: any) => {
    setOnlineRoom(room); setTeamMode(!!room.teamMode); setTeamName(room.teamName || 'تیم باران'); setLeague(room.league || 'دوستانه'); setMusicConsent(room.music?.consent || {})
    const mapped = Array.from({length:4}, (_, id) => {
      const member = room.players?.find((p:any) => p.seat === id)
      return { id, name: member?.name || 'جایگاه خالی', color: COLORS[id], human: !!member, start: STARTS[id] }
    })
    setPlayers(mapped); setTokens(room.tokens || freshTokens()); setTurn(room.currentTurn || 0); setMoveHistory((room.history || []).slice(-30).reverse().map((h:any)=>({name:h.name,detail:h.detail,time:new Date(h.at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})})))
    setDice(room.dice ?? null); setWinner(room.status === 'finished' ? room.currentTurn : null)
    if (room.status === 'finished') setMessage(room.teamMode ? `${room.winnerTeam || (room.currentTurn % 2 === 0 ? room.teamName : 'تیم رقیب')} برنده بازی تیمی شد!` : `${mapped[room.currentTurn]?.name || 'بازیکن'} برنده بازی شد!`)
    setGameStarted(room.status === 'playing' || room.status === 'finished')
  }
  const connectOnline = (code: string, role: 'player'|'spectator' = 'player') => {
    reconnectEnabledRef.current = true
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
    const name = localStorage.getItem('k-mench-player-name') || 'بازیکن باران'
    const savedId = localStorage.getItem('k-mench-player-' + code)
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//k-mench-server.mohsen11740.workers.dev/api/rooms/${code}/connect?name=${encodeURIComponent(name)}${savedId ? '&playerId='+encodeURIComponent(savedId) : ''}${!savedId && role==='spectator' ? '&role=spectator' : ''}`)
    setOnlineError('در حال اتصال به اتاق آنلاین...')
    ws.onmessage = event => {
      const data = JSON.parse(event.data)
      if (data.type === 'join-pending') { setOnlineError(data.message || 'در انتظار تأیید میزبان...'); setInviteCode(code); setIsSpectator(role==='spectator') }
      if (data.type === 'join-denied') { setOnlineError(data.message || 'درخواست ورود رد شد.'); reconnectEnabledRef.current = false; ws.close(1008, 'Denied') }
      if (data.type === 'join-request') setJoinRequests(old=>[...old.filter(x=>x.requestId!==data.request.requestId),data.request])
      if (data.type === 'welcome') {
        localStorage.setItem('k-mench-player-' + code, data.playerId)
        setIsSpectator(!!data.spectator); onlineSeatRef.current = data.seat; setOnlineSeat(data.seat); setInviteCode(code); setOnlineError(data.spectator ? 'به‌عنوان تماشاگر وارد اتاق شده‌اید.' : 'ورود شما تأیید شد.'); applyOnlineRoom(data.room)
        if (data.music) { setMusicUrl(data.music.url || ''); setMusicActive(!!data.music.playing); setMusicStartedAt(data.music.startedAt || null); setMusicConsent(data.music.consent || {}); setMusicAllowed(data.seat === 0) }
        setOnlineError('اتصال آنلاین برقرار است.')
      }
      if (data.type === 'state' || data.type === 'presence') applyOnlineRoom(data.room)
      if (data.type === 'chat') setChatMessages(old => [...old.slice(-49), data.message])
      if (data.type === 'voice') setChatMessages(old => [...old.slice(-19), data.message])
      if (data.type === 'music') { setMusicUrl(data.url || ''); setMusicActive(!!data.playing); setMusicStartedAt(data.startedAt || null); setMusicConsent(data.consent || {}); setMusicAllowed(data.playing && data.consent?.[String(onlineSeatRef.current ?? -1)] === true) }
      if (data.type === 'music-consent') setMusicConsent(data.consent || {})
    }
    ws.onerror = () => setOnlineError('اتصال به سرور برقرار نشد. سرور باید منتشر شده باشد.')
    ws.onclose = (event) => { setOnlineError('ارتباط اتاق قطع شد. تلاش برای اتصال مجدد...'); if (reconnectEnabledRef.current && event.code !== 1008) reconnectTimerRef.current = window.setTimeout(()=>connectOnline(code, role), 1800) }
    setOnlineSocket(ws)
  }
  const decideJoin = (requestId:string, allow:boolean, role?:'player'|'spectator') => { if (onlineSocket?.readyState===WebSocket.OPEN) onlineSocket.send(JSON.stringify({type:'join-decision',requestId,allow,role})); setJoinRequests(old=>old.filter(x=>x.requestId!==requestId)) }
  const begin = () => {
    if (onlineSocket) {
      const connected = onlineRoom?.players?.filter((p:any) => p.connected).length || 0
      if (connected < 2) { setMessage('برای شروع بازی آنلاین، دست‌کم دو بازیکن باید وارد اتاق شوند.'); return }
      if (teamMode && connected !== 4) { setMessage('برای بازی تیمی آنلاین، هر چهار بازیکن باید وارد اتاق شوند.'); return }
      onlineSocket.send(JSON.stringify({type:'start', league, teamMode, teamName})); return
    }
    const chosenNames = playerNames.map((n,i)=>i===0 ? (localPlayerName.trim() || 'باران') : (n.trim() || `بازیکن ${i+1}`))
    setPlayerNames(chosenNames)
    localStorage.setItem('k-mench-player-name', chosenNames[0])
    localStorage.setItem('k-mench-player-names', JSON.stringify(chosenNames))
    setPlayers(makePlayers(humanCount)); setTokens(freshTokens()); setTurn(0); setDice(null)
    setWinner(null); setGameStarted(true); setMessage('نوبت بازیکن قرمز است. تاس بیندازید.')
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search); const code = params.get('invite')?.toUpperCase(); const role = params.get('spectate') === '1' ? 'spectator' : 'player'
    if (code && /^[A-HJ-NP-Z2-9]{6}$/.test(code)) connectOnline(code, role)
    return () => { reconnectEnabledRef.current = false; if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current) }
  }, [])
  useEffect(() => { if (!gameStarted || winner !== null || players.length === 0 || players[turn]?.human || rolling || dice !== null) return
    const timer = window.setTimeout(() => rollDice(true), 850)
    return () => window.clearTimeout(timer)
  }, [turn, gameStarted, winner, players, rolling, dice, onlineSocket])

  const movable = useMemo(() => {
    if (dice === null) return []
    return tokens[turn].map((t,i) => ({...t,i})).filter(t => t.progress === -1 ? dice === 6 : t.progress < 57 && t.progress + dice <= 57)
  }, [dice,tokens,turn])

  function rollDice(ai = false) {
    if (onlineSocket && onlineRoom?.status === 'playing') { if (onlineSeat === turn) onlineSocket.send(JSON.stringify({type:'roll'})); return }
    if (rolling || winner !== null || dice !== null) return
    setRolling(true)
    const value = Math.floor(Math.random()*6)+1
    window.setTimeout(() => {
      setDice(value); setRolling(false)
      const choices = tokens[turn].filter(t => t.progress === -1 ? value === 6 : t.progress < 57 && t.progress+value <= 57)
      if (!choices.length) {
        setMessage(`عدد ${value} آمد. حرکت ممکن نیست.`)
        window.setTimeout(() => { setDice(null); setTurn(t => (t+1)%4) }, 850)
      } else setMessage(ai ? `هوش مصنوعی ${turn+1} عدد ${value} آورد.` : `عدد ${value} آمد. مهره موردنظر را انتخاب کنید.`)
    }, 420)
  }
  function moveToken(index: number) {
    if (onlineSocket && onlineRoom?.status === 'playing') { if (onlineSeat === turn && dice !== null) onlineSocket.send(JSON.stringify({type:'move', token:index})); return }
    if (dice === null || winner !== null || !movable.some(t => t.i === index)) return
    const value = dice
    const next = tokens.map(row => row.map(t => ({...t})))
    const old = next[turn][index].progress
    const progress = old === -1 ? 0 : old + value
    next[turn][index].progress = progress
    const globalPosition = (players[turn].start + progress) % 52
    let captured = false
    if (progress < 51 && !SAFE.has(globalPosition)) {
      next.forEach((row,p) => { if (p !== turn) row.forEach(t => {
        if (t.progress >= 0 && t.progress < 51 && (players[p].start+t.progress)%52 === globalPosition) {
          t.progress = -1; captured = true
        }
      })})
    }
    setTokens(next); setDice(null)
    setMoveHistory(old=>[{name:players[turn]?.name||'بازیکن',detail:`مهره ${index+1} حرکت کرد${progress===57?' و به مقصد رسید':''}${captured?' و مهره حریف را زد':''}`,time:new Date().toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})},...old].slice(0,30))
    setLocalStats(old=>{const n={...old};const st={wins:0,losses:0,captures:0,completed:0,moves:0,...n[String(turn)]};st.moves++;if(progress===57)st.completed++;if(captured)st.captures++;n[String(turn)]=st;return n})
    const teamSeats = turn % 2 === 0 ? [0, 2] : [1, 3]
    const hasWon = teamMode ? teamSeats.every(seat => next[seat].every(t => t.progress === 57)) : next[turn].every(t => t.progress === 57)
    if (hasWon) { setLocalStats(old=>{const n={...old};players.forEach((p,i)=>{const st={wins:0,losses:0,captures:0,completed:0,moves:0,...n[String(i)]};if(teamMode ? i%2===turn%2 : i===turn)st.wins++;else st.losses++;n[String(i)]=st});return n}); setWinner(turn); setMessage(teamMode ? `${turn % 2 === 0 ? teamName : 'تیم رقیب'} برنده بازی تیمی شد!` : `${players[turn].name} برنده بازی شد!`); return }
    if (value === 6 || captured) setMessage(captured ? 'مهره حریف زده شد! یک نوبت اضافه دارید.' : 'شش آوردید! یک نوبت اضافه دارید.')
    else setTurn(t => (t+1)%4)
  }
  useEffect(() => {
    if (winner === null || !gameStarted) return
    const key = `${league}:${teamMode ? 'team' : 'solo'}`
    setLeagueScores(old => { const next = { ...old, [key]: (old[key] || 0) + 1 }; localStorage.setItem('k-mench-league-scores', JSON.stringify(next)); return next })
  }, [winner])
  useEffect(() => {
    const audio = musicAudioRef.current
    if (!audio || !musicUrl) return
    if (!musicActive || (onlineSocket && !musicAllowed)) { audio.pause(); return }
    if (musicStartedAt) audio.currentTime = Math.max(0, (Date.now() - musicStartedAt) / 1000)
    if (!soundEnabled) { audio.pause(); return }
    audio.play().catch(() => setOnlineError('برای پخش هم‌زمان موسیقی، هر بازیکن باید یک‌بار دکمه پخش را لمس کند.'))
  }, [musicActive, musicStartedAt, musicUrl, musicAllowed, onlineSocket, soundEnabled])
  useEffect(() => {
    if (onlineSocket || dice === null || players[turn]?.human || winner !== null) return
    const options = movable.map(t=>t.i)
    if (options.length) {
      const chosen = options[Math.floor(Math.random()*options.length)]
      const timer = window.setTimeout(() => moveToken(chosen), 700)
      return () => window.clearTimeout(timer)
    }
  }, [dice, turn, movable, players, winner, onlineSocket])

  function tokenPosition(player: number, tokenIndex: number): [number,number] {
    const p = tokens[player][tokenIndex].progress
    if (p < 0) return BASES[player][tokenIndex]
    if (p >= 52) return LANES[player][p-52]
    return TRACK[(players[player].start+p)%52]
  }
  const newInvite = async () => {
    reconnectEnabledRef.current = false; if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current)
    onlineSocket?.close(); setOnlineSocket(null); setOnlineRoom(null); setOnlineSeat(null)
    try {
      const response = await fetch('https://k-mench-server.mohsen11740.workers.dev/api/rooms', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:localStorage.getItem('k-mench-player-name') || 'میزبان'})})
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'ساخت اتاق ناموفق بود.')
      setInviteCode(data.code); setShowInvite(true); connectOnline(data.code)
    } catch (error) { setOnlineError(error instanceof Error ? error.message : 'سرور آنلاین در دسترس نیست.'); setShowInvite(true) }
  }
  async function shareInvite() {
    const url = `${location.origin}/?invite=${inviteCode}`
    const text = `به بازی K-MENCH، بازی منچ باران بپیوند! کد دعوت: ${inviteCode}\n${url}`
    if (navigator.share) { try { await navigator.share({title:'دعوت به K-MENCH',text,url}) } catch {} }
    else if (navigator.clipboard) { await navigator.clipboard.writeText(text); setMessage('متن دعوت کپی شد؛ آن را در پیام‌رسان دلخواه بفرستید.') }
  }
  const teamCaptures = [0,1].map(team=>[team*1,team===0?2:3].reduce((sum,seat)=>sum+(onlineRoom?.stats?.[String(seat)]?.captures || localStats[String(seat)]?.captures || 0),0))
  const teamCompleted = [0,1].map(team=>[team*1,team===0?2:3].reduce((sum,seat)=>sum+(onlineRoom?.stats?.[String(seat)]?.completed || localStats[String(seat)]?.completed || 0),0))
  const mvp = players.map(p=>{const st=onlineRoom?.stats?.[String(p.id)]||localStats[String(p.id)]||{};return {name:p.name,score:(st.captures||0)*2+(st.completed||0)*3+(st.wins||0)*5}}).sort((a,b)=>b.score-a.score)[0]
  function tokenSvg(p:number, i:number, x:number,y:number) {
    const active = p === turn && dice !== null && movable.some(t=>t.i===i)
    return <g key={`${p}-${i}`} onClick={() => players[p]?.human && p===turn && moveToken(i)} className={active?'token active':'token'} style={{cursor:active?'pointer':'default'}}>
      <circle cx={x*40+20} cy={y*40+20} r="13" fill={COLORS[p]} stroke="#fff8e8" strokeWidth="3"/>
      <circle cx={x*40+20} cy={y*40+20} r="4" fill="#fff8e8"/>
    </g>
  }
  return <main className="app-shell" data-theme={themeId} data-dice={diceStyle}>{gameStarted && <div className="start-flash"><strong>BM · BARAN MENCH</strong></div>}
    <header className="topbar"><div className="brand"><img className="brand-logo" src="/icon.svg" alt="BM baran-mench" /><div><strong>BM</strong><small>baran-mench</small></div></div><div className="top-actions"><span className="online-pill"><i/> {onlineSocket ? 'بازی آنلاین' : 'بازی محلی'}</span><button className="icon-button" onClick={newInvite} aria-label="دعوت دوستان"><Share2 size={18}/></button></div></header>
    <section className="hero"><div className="hero-copy"><span className="eyebrow"><Sparkles size={14}/> دورهمی با رنگ‌وبوی ایرانی</span><h1>یک تاس، چهار رنگ،<br/><em>یک عالمه هیجان!</em></h1><p>منچ کلاسیک با حال‌وهوای تازه، برای بازی کنار خانواده و دوستان.</p><div className="hero-tags"><span>۴ مهره برای هر نفر</span><span>۱ تا ۴ بازیکن</span><span>هوش مصنوعی</span></div></div><div className="hero-art"><div className="sunburst">✦</div><div className="art-dice"><span>⚄</span></div><div className="art-token red"/><div className="art-token gold"/><div className="art-token green"/><div className="art-token blue"/></div></section>
    <section className="game-layout">
      <div className="board-card"><div className="section-heading"><div><span className="eyebrow">صفحه بازی</span><h2>میدان منچ باران</h2></div><span className="turn-label" style={{'--turn-color':players[turn]?.color||COLORS[0]} as CSSProperties}>{gameStarted ? `نوبت: ${players[turn]?.name}` : onlineSocket ? 'اتاق آنلاین' : 'آماده شروع'}</span></div>
        <div className="board-wrap">{gameStarted && <div className={`dice-center ${diceStyle}`} aria-live="polite"><DiceCube value={dice} rolling={rolling}/></div>}<svg className="board" viewBox="0 0 600 600" role="img" aria-label="صفحه بازی منچ چهار رنگ">
          <rect x="4" y="4" width="592" height="592" rx="24" fill="#f6eedb" stroke="#d4c49d" strokeWidth="4"/>
          {[[0,0],[9,0],[9,9],[0,9]].map(([x,y],i)=><g key={i}><rect x={x*40+20} y={y*40+20} width="220" height="220" rx="18" fill={COLORS[i]} opacity=".16" stroke={COLORS[i]} strokeWidth="3"/><rect x={x*40+60} y={y*40+60} width="140" height="140" rx="18" fill="#fffaf0" stroke={COLORS[i]} strokeWidth="3" opacity=".9"/>{Array.from({length:4},(_,j)=>{const [bx,by]=BASES[i][j];return <circle key={j} cx={bx*40+20} cy={by*40+20} r="16" fill={COLORS[i]} opacity=".2" stroke={COLORS[i]} strokeWidth="2"/>})}</g>)}
          {TRACK.map(([x,y],i)=><g key={i}><rect x={x*40+3} y={y*40+3} width="34" height="34" rx="7" fill={SAFE.has(i)?'#e7d8b5':'#fffaf0'} stroke="#d8cba9" strokeWidth="1.5"/>{SAFE.has(i)&&<text x={x*40+20} y={y*40+26} textAnchor="middle" fontSize="17" fill="#a68d56">✦</text>}</g>)}
          {LANES.map((lane,p)=>lane.map(([x,y],i)=><rect key={`${p}-${i}`} x={x*40+3} y={y*40+3} width="34" height="34" rx="7" fill={COLORS[p]} opacity=".28" stroke={COLORS[p]} strokeWidth="1.5"/>))}
          <path d="M280 280 L320 280 L320 320 L280 320Z" fill="#d7b56d"/><path d="M280 280 L300 300 L280 320Z" fill={COLORS[0]}/><path d="M280 280 L320 280 L300 300Z" fill={COLORS[1]}/><path d="M320 280 L320 320 L300 300Z" fill={COLORS[2]}/><path d="M280 320 L320 320 L300 300Z" fill={COLORS[3]}/>
          {gameStarted && players.map((pl,p)=>tokens[p].map((_,i)=>{const [x,y]=tokenPosition(p,i);return tokenSvg(p,i,x,y)}))}
        </svg></div>
        <div className="board-legend">{names.map((n,i)=><span key={n}><i style={{background:COLORS[i]}}/>{n}</span>)}</div>
      </div>
      <aside className="side-panel">
        {!gameStarted ? <div className="setup-card"><span className="eyebrow">تنظیم بازی</span><h2>{onlineSocket ? "اتاق آنلاین ساخته شد" : "چند نفر بازی می‌کنید؟"}</h2><p>{onlineSocket ? (onlineError || "دوستتان را با کد دعوت وارد اتاق کنید.") : "جایگاه‌های خالی با هوش مصنوعی تکمیل می‌شوند."}</p>
          {onlineSocket && onlineSeat===null && !onlineRoom && <div className="join-wait-card"><strong>درخواست ورود ارسال شد</strong><span>تا زمانی که میزبان اجازه ندهد، امکان ورود به بازی وجود ندارد.</span></div>}
          {onlineSocket && onlineSeat===0 && joinRequests.length>0 && <div className="join-request-list"><strong>درخواست‌های ورود مهمان</strong>{joinRequests.map(req=><div className="join-request" key={req.requestId}><span>{req.name} · {req.role==='spectator'?'تماشاگر':'بازیکن'}</span><button className="chat-send" onClick={()=>decideJoin(req.requestId,true)}>اجازه ورود</button><button className="chat-send deny" onClick={()=>decideJoin(req.requestId,false)}>رد درخواست</button></div>)}</div>}
          {onlineSocket && onlineSeat===0 && onlineRoom?.pendingJoins?.filter((r:any)=>!joinRequests.some(x=>x.requestId===r.requestId)).map((req:any)=><div className="join-request" key={req.requestId}><span>{req.name} · {req.role==='spectator'?'تماشاگر':'بازیکن'}</span><button className="chat-send" onClick={()=>decideJoin(req.requestId,true)}>اجازه ورود</button><button className="chat-send deny" onClick={()=>decideJoin(req.requestId,false)}>رد درخواست</button></div>)}
          {isSpectator && <div className="join-wait-card"><strong>حالت تماشاگر</strong><span>می‌توانید بازی و آمار را ببینید، اما مهره یا تاس را کنترل نمی‌کنید.</span></div>}<div className="player-name-list"><strong>نام بازیکنان این دور</strong>{Array.from({length:onlineSocket ? (onlineRoom?.players?.length || 1) : humanCount},(_,i)=><label className="field-label" key={i}>نام بازیکن {i+1}<input className="player-name-input" value={i===0?localPlayerName:(playerNames[i] || `بازیکن ${i+1}`)} maxLength={18} onChange={e=>{if(i===0)setLocalPlayerName(e.target.value);else setPlayerNames(old=>old.map((n,j)=>j===i?e.target.value:n))}} placeholder={`نام بازیکن ${i+1}`} /></label>)}</div><div className="count-picker">{[1,2,3,4].map(n=><button key={n} className={humanCount===n?'selected':''} onClick={()=>setHumanCount(n)}>{n}<small>{n===1?'نفر': 'نفر'}</small></button>)}</div><div className="theme-picker"><strong>نقش ایرانی صفحه</strong><div className="theme-options">{IRANIAN_THEMES.map(t=><button type="button" key={t.id} className={themeId===t.id?'chosen':''} onClick={()=>setThemeId(t.id)}><span>{t.symbol}</span>{t.name}</button>)}</div></div><div className="theme-picker"><strong>نوع رقابت</strong><select className="player-name-input" value={league} onChange={e=>setLeague(e.target.value)}><option>دوستانه</option><option>لیگ خانوادگی</option><option>جام باران</option><option>حذفی</option></select><label className="field-label"><span><input type="checkbox" checked={teamMode} onChange={e=>setTeamMode(e.target.checked)}/> بازی تیمی دونفره</span></label>{teamMode && <input className="player-name-input" value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder="نام تیم"/>}</div><div className="theme-picker"><strong>مدل تاس</strong><div className="dice-options">{DICE_STYLES.map(d=><button type="button" key={d.id} className={diceStyle===d.id?'chosen':''} onClick={()=>setDiceStyle(d.id)}>{d.name}</button>)}</div></div><div className="seat-list">{(onlineSocket ? players : makePlayers(humanCount)).map(p=><div className="seat" key={p.id}><i style={{background:p.color}}/><span>{p.name}</span><small>{p.human?'انسان':'هوش مصنوعی'}</small></div>)}</div><button className="primary-button" disabled={!!onlineSocket && ((onlineRoom?.players?.filter((p:any) => p.connected).length || 0) < (teamMode ? 4 : 2) || onlineSeat !== 0)} onClick={begin}><Gamepad2 size={18}/> {onlineSocket ? 'شروع بازی آنلاین' : 'شروع بازی'}</button></div> : <div className="control-card"><span className="eyebrow">کنترل بازی</span><h2>{winner!==null?'پایان بازی':players[turn]?.name}</h2><div className="player-name-list in-game-name"><strong>نام بازیکنان، قابل ویرایش</strong>{players.filter(p=>p.human).map(p=><label className="field-label" key={p.id}>{`بازیکن ${p.id+1}`}<input className="player-name-input" value={p.name} maxLength={24} disabled={!!onlineSocket && onlineSeat!==p.id} onChange={e=>renamePlayer(p.id,e.target.value)} onBlur={()=>savePlayerName(p.id)} placeholder="نام دلخواه" /></label>)}</div><p>{onlineError || message}</p><div className={`dice-face ${rolling?'shake':''}`}><DiceCube value={dice} rolling={rolling}/></div>{(onlineSocket ? onlineSeat===turn : players[turn]?.human) && gameStarted && winner===null && <button className="primary-button" disabled={rolling||dice!==null} onClick={()=>rollDice()}><Dice5 size={19}/>{rolling?'در حال انداختن تاس...':'انداختن تاس'}</button>}{dice!==null&&(onlineSocket ? onlineSeat===turn : players[turn]?.human)&&movable.length>0&&<small className="hint">یکی از مهره‌های روشن را روی صفحه انتخاب کنید.</small>}{winner!==null&&<button className="primary-button" onClick={onlineSocket ? newInvite : begin}><RotateCcw size={18}/> بازی دوباره</button>}<button className="subtle-button" onClick={newInvite}><Share2 size={16}/> دعوت از دوستان</button></div>}
        <section className="social-card"><div className="social-head"><strong>گفت‌وگوی بازیکنان</strong><button className="subtle-button" onClick={()=>setShowRules(true)}>قوانین بازی</button></div><div className="chat-feed">{chatMessages.map((m,i)=><div className="chat-message" key={i}><b>{m.name}</b><small>{m.time}</small>{m.kind==='voice'?<audio controls src={m.audio}/>:<p>{m.text}</p>}</div>)}</div><div className="chat-compose"><input className="player-name-input" value={chatDraft} onChange={e=>setChatDraft(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} placeholder="پیام بنویس..."/><button className="chat-send" onClick={sendChat}>ارسال</button><button className={recording?'chat-send recording':'chat-send'} onClick={toggleVoice}>{recording?'پایان ضبط':'🎙'}</button></div></section>
        <section className="social-card"><strong>موسیقی اتاق با اجازه اعضا</strong><label className="sound-toggle"><input type="checkbox" checked={soundEnabled} onChange={e=>{setSoundEnabled(e.target.checked);localStorage.setItem('k-mench-sound',e.target.checked?'on':'off')}}/> پخش صدا و موسیقی برای من</label>{(!onlineSocket || onlineSeat === 0) ? <><input className="player-name-input" value={musicUrl} onChange={e=>setMusicUrl(e.target.value)} placeholder="لینک مستقیم فایل صوتی (https://...)"/><div className="music-controls"><button className="chat-send" onClick={()=>setSharedMusic(true)} disabled={!musicUrl.trim()}>درخواست اجازه و پخش</button><button className="chat-send" onClick={()=>setSharedMusic(false)}>توقف موسیقی</button></div>{onlineSocket && musicActive && <div className="music-consent-list"><b>وضعیت اجازه اعضا</b>{players.filter(p=>p.human).map(p=><span key={p.id}>{p.name}: {p.id===0 ? "میزبان، مجاز" : musicConsent[String(p.id)]===true ? "اجازه داده" : musicConsent[String(p.id)]===false ? "رد کرده" : "منتظر پاسخ"}</span>)}</div>}</> : musicActive ? <div className="music-consent-prompt"><span>{musicAllowed ? "اجازه داده‌اید، موسیقی برای شما پخش می‌شود." : "میزبان درخواست پخش موسیقی داده است. مایلید؟"}</span><div className="music-controls"><button className="chat-send" onClick={()=>answerMusicConsent(true)}>{musicAllowed ? "اجازه داده‌اید" : "اجازه می‌دهم"}</button><button className="chat-send" onClick={()=>answerMusicConsent(false)}>اجازه نمی‌دهم</button></div></div> : <p>وقتی میزبان پخش موسیقی را درخواست کند، اجازه پخش برای شما نمایش داده می‌شود.</p>}{musicUrl && <audio ref={musicAudioRef} controls={!!musicAllowed} autoPlay={musicActive && musicAllowed} src={musicUrl}/>}</section>
        <div className="mini-stats"><div><Users size={18}/><strong>۴</strong><small>جایگاه بازی</small></div><div><Medal size={18}/><strong>۱۶</strong><small>مهره در میدان</small></div><div><Crown size={18}/><strong>۱</strong><small>قهرمان نهایی</small></div></div>
      </aside>
    </section>
    <section className="social-card player-scoreboard"><strong>وضعیت مهره‌های بازیکنان</strong><div className="player-score-grid"><div className="player-score-header"><span>بازیکن</span><span>بیرون</span><span>مسیر</span><span>خانه</span></div>{players.map((p)=>{const row=tokens[p.id] || []; const outside=row.filter(t=>t.progress<0).length; const track=row.filter(t=>t.progress>=0&&t.progress<52).length; const home=row.filter(t=>t.progress>=52).length; return <div className="player-score-row" key={p.id}><span className="score-player-name"><i style={{background:p.color}}/>{p.name}</span><b>{outside}</b><b>{track}</b><b>{home}</b></div>})}</div><small>هر بازیکن ۴ مهره دارد. «خانه» شامل مسیر پایانی و مهره‌های به مقصد رسیده است.</small></section>\n    <section className="social-card live-team-stats"><strong>آمار زنده تیم‌ها</strong><div className="team-stat-grid"><div><b>{teamMode ? teamName : 'تیم قرمز و سبز'}</b><strong>{teamCaptures[0]}</strong><small>مهره حریف زده‌شده</small><strong>{teamCompleted[0]}</strong><small>مهره به مقصد رسیده</small></div><div><b>{teamMode ? 'تیم رقیب' : 'تیم زرد و آبی'}</b><strong>{teamCaptures[1]}</strong><small>مهره حریف زده‌شده</small><strong>{teamCompleted[1]}</strong><small>مهره به مقصد رسیده</small></div></div><small>بازیکن برتر فعلی: {mvp?.name || 'هنوز مشخص نیست'}</small></section>
    <section className="social-card"><strong>افتخارات بازیکنان</strong><div className="player-honors">{players.map(p=>{const st=onlineRoom?.stats?.[String(p.id)]||localStats[String(p.id)]||{};return <div key={p.id}><b>{p.name}</b><span>{st.wins||0} برد</span><span>{st.losses||0} باخت</span><span>{st.captures||0} زدن مهره</span><span>{st.completed||0} مهره کامل</span></div>})}</div></section>
    <section className="social-card"><strong>تاریخچه حرکت‌ها</strong><div className="move-history">{moveHistory.length?moveHistory.map((h,i)=><div key={i}><b>{h.name}</b><span>{h.detail}</span><small>{h.time}</small></div>):<p>با شروع حرکت‌ها، تاریخچه اینجا ثبت می‌شود.</p>}</div></section>
    <section className="social-card league-scoreboard"><strong>جدول امتیاز لیگ‌ها</strong>{Object.entries(onlineRoom?.leagueWins || leagueScores).length ? Object.entries(onlineRoom?.leagueWins || leagueScores).map(([key,score])=><div className="league-score-row" key={key}><span>{key.replace(':',' · ')}</span><b>{String(score)} برد</b></div>) : <p>با پایان هر بازی، بردها در این دستگاه ذخیره می‌شوند.</p>}</section>
    <section className="features"><div><span className="feature-icon">🎲</span><strong>قانون کلاسیک</strong><small>ورود با شش، حرکت مهره و زدن حریف</small></div><div><span className="feature-icon">🤖</span><strong>هم‌بازی هوشمند</strong><small>از تنهایی تا یک جمع چهارنفره</small></div><div><span className="feature-icon">📲</span><strong>قابل نصب</strong><small>روی موبایل و رایانه، بدون فروشگاه</small></div></section>
    <footer><strong>K-MENCH · بازی منچ باران</strong><span>طراحی و توسعه با احترام به بازی‌های دورهمی ایرانی</span><b>© تمامی حقوق این اثر متعلق به باران عبدی است.</b></footer>
    {showRules&&<div className="modal-backdrop" onClick={()=>setShowRules(false)}><div className="invite-modal rules-modal" onClick={e=>e.stopPropagation()}><button className="close-modal" onClick={()=>setShowRules(false)}>×</button><h2>قوانین منچ کلاسیک</h2><ul><li>برای خارج کردن مهره از خانه باید ۶ بیاورید.</li><li>هر بازیکن چهار مهره دارد و با تاس حرکت می‌کند.</li><li>با رسیدن روی مهره حریف در خانه غیرایمن، آن مهره به خانه برمی‌گردد.</li><li>خانه‌های امن با ستاره مشخص شده‌اند.</li><li>برای ورود به خانه پایانی باید عدد دقیق بیاورید.</li><li>اولین بازیکنی که هر چهار مهره را به مقصد برساند برنده است.</li></ul><p>در بازی تیمی، جایگاه‌های ۱ و ۳ هم‌تیمی‌اند و جایگاه‌های ۲ و ۴ تیم مقابل را می‌سازند. جدول لیگ محلی روی همین دستگاه ذخیره می‌شود.</p></div></div>}
    {showInvite&&<div className="modal-backdrop" onClick={()=>setShowInvite(false)}><div className="invite-modal" onClick={e=>e.stopPropagation()}><button className="close-modal" onClick={()=>setShowInvite(false)}>×</button><div className="invite-symbol"><MessageCircle/></div><span className="eyebrow">دعوت به بازی</span><h2>دوستت رو به منچ باران دعوت کن</h2><p>{onlineError || 'کد دعوت برای اشتراک‌گذاری آماده شد.'}</p>{inviteCode && <><div className="invite-code">{inviteCode}</div><button className="primary-button" onClick={shareInvite}><Share2 size={18}/> اشتراک‌گذاری کد و لینک</button></>}<button className="subtle-button" onClick={()=>{const url=`${location.origin}/?invite=${inviteCode}&spectate=1`;if(navigator.share)navigator.share({title:'تماشای بازی منچ باران',url}).catch(()=>{});else navigator.clipboard?.writeText(url).then(()=>setMessage('لینک تماشاگر کپی شد.'))}}>اشتراک‌گذاری لینک تماشاگر</button><small>از منوی اشتراک‌گذاری گوشی می‌توانید پیامک، واتساپ، تلگرام و دیگر پیام‌رسان‌ها را انتخاب کنید. ارسال پیامک با تأیید خودتان انجام می‌شود.</small></div></div>}
  </main>
}
export default App
