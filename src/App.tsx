import { useEffect, useMemo, useState, type CSSProperties } from 'react'
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
const freshTokens = (): Token[][] => Array.from({length:4}, () => Array.from({length:4}, () => ({progress:-1})))
function App() {
  const [humanCount, setHumanCount] = useState(1)
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

  const makePlayers = (count: number): Player[] => names.map((name, id) => ({
    id, name: id < count ? (id === 0 ? 'بازیکن شما' : `بازیکن ${id+1}`) : `هوش مصنوعی ${id+1-count}`,
    color: COLORS[id], human: id < count, start: STARTS[id],
  }))
  const applyOnlineRoom = (room: any) => {
    setOnlineRoom(room)
    const mapped = Array.from({length:4}, (_, id) => {
      const member = room.players?.find((p:any) => p.seat === id)
      return { id, name: member?.name || 'جایگاه خالی', color: COLORS[id], human: !!member, start: STARTS[id] }
    })
    setPlayers(mapped); setTokens(room.tokens || freshTokens()); setTurn(room.currentTurn || 0)
    setDice(room.dice ?? null); setWinner(room.status === 'finished' ? room.currentTurn : null)
    setGameStarted(room.status === 'playing' || room.status === 'finished')
  }
  const connectOnline = (code: string) => {
    const name = localStorage.getItem('k-mench-player-name') || 'بازیکن باران'
    const savedId = localStorage.getItem('k-mench-player-' + code)
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//k-mench-server.mohsen11740.workers.dev/api/rooms/${code}/connect?name=${encodeURIComponent(name)}${savedId ? '&playerId='+encodeURIComponent(savedId) : ''}`)
    setOnlineError('در حال اتصال به اتاق آنلاین...')
    ws.onmessage = event => {
      const data = JSON.parse(event.data)
      if (data.type === 'welcome') {
        localStorage.setItem('k-mench-player-' + code, data.playerId)
        setOnlineSeat(data.seat); setInviteCode(code); applyOnlineRoom(data.room)
        setOnlineError('اتصال آنلاین برقرار است.')
      }
      if (data.type === 'state' || data.type === 'presence') applyOnlineRoom(data.room)
    }
    ws.onerror = () => setOnlineError('اتصال به سرور برقرار نشد. سرور باید منتشر شده باشد.')
    ws.onclose = () => setOnlineError('ارتباط اتاق قطع شد. برای اتصال دوباره از کد دعوت استفاده کنید.')
    setOnlineSocket(ws)
  }
  const begin = () => {
    if (onlineSocket) {
      if ((onlineRoom?.players?.length || 0) < 2) { setMessage('برای شروع بازی آنلاین، دست‌کم دو بازیکن باید وارد اتاق شوند.'); return }
      onlineSocket.send(JSON.stringify({type:'start'})); return
    }
    setPlayers(makePlayers(humanCount)); setTokens(freshTokens()); setTurn(0); setDice(null)
    setWinner(null); setGameStarted(true); setMessage('نوبت بازیکن قرمز است. تاس بیندازید.')
  }
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('invite')?.toUpperCase()
    if (code && /^[A-HJ-NP-Z2-9]{6}$/.test(code)) connectOnline(code)
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
    if (next[turn].every(t => t.progress === 57)) { setWinner(turn); setMessage(`${players[turn].name} برنده بازی شد!`); return }
    if (value === 6 || captured) setMessage(captured ? 'مهره حریف زده شد! یک نوبت اضافه دارید.' : 'شش آوردید! یک نوبت اضافه دارید.')
    else setTurn(t => (t+1)%4)
  }
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
  function tokenSvg(p:number, i:number, x:number,y:number) {
    const active = p === turn && dice !== null && movable.some(t=>t.i===i)
    return <g key={`${p}-${i}`} onClick={() => players[p]?.human && p===turn && moveToken(i)} className={active?'token active':'token'} style={{cursor:active?'pointer':'default'}}>
      <circle cx={x*40+20} cy={y*40+20} r="13" fill={COLORS[p]} stroke="#fff8e8" strokeWidth="3"/>
      <circle cx={x*40+20} cy={y*40+20} r="4" fill="#fff8e8"/>
    </g>
  }
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">K</div><div><strong>K-MENCH</strong><small>بازی منچ باران</small></div></div><div className="top-actions"><span className="online-pill"><i/> {onlineSocket ? 'بازی آنلاین' : 'بازی محلی'}</span><button className="icon-button" onClick={newInvite} aria-label="دعوت دوستان"><Share2 size={18}/></button></div></header>
    <section className="hero"><div className="hero-copy"><span className="eyebrow"><Sparkles size={14}/> دورهمی با رنگ‌وبوی ایرانی</span><h1>یک تاس، چهار رنگ،<br/><em>یک عالمه هیجان!</em></h1><p>منچ کلاسیک با حال‌وهوای تازه، برای بازی کنار خانواده و دوستان.</p><div className="hero-tags"><span>۴ مهره برای هر نفر</span><span>۱ تا ۴ بازیکن</span><span>هوش مصنوعی</span></div></div><div className="hero-art"><div className="sunburst">✦</div><div className="art-dice"><span>⚄</span></div><div className="art-token red"/><div className="art-token gold"/><div className="art-token green"/><div className="art-token blue"/></div></section>
    <section className="game-layout">
      <div className="board-card"><div className="section-heading"><div><span className="eyebrow">صفحه بازی</span><h2>میدان منچ باران</h2></div><span className="turn-label" style={{'--turn-color':players[turn]?.color||COLORS[0]} as CSSProperties}>{gameStarted ? `نوبت: ${players[turn]?.name}` : onlineSocket ? 'اتاق آنلاین' : 'آماده شروع'}</span></div>
        <div className="board-wrap"><svg className="board" viewBox="0 0 600 600" role="img" aria-label="صفحه بازی منچ چهار رنگ">
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
        {!gameStarted ? <div className="setup-card"><span className="eyebrow">تنظیم بازی</span><h2>چند نفر بازی می‌کنید؟</h2><p>جایگاه‌های خالی با هوش مصنوعی تکمیل می‌شوند.</p><div className="count-picker">{[1,2,3,4].map(n=><button key={n} className={humanCount===n?'selected':''} onClick={()=>setHumanCount(n)}>{n}<small>{n===1?'نفر': 'نفر'}</small></button>)}</div><div className="seat-list">{makePlayers(humanCount).map(p=><div className="seat" key={p.id}><i style={{background:p.color}}/><span>{p.name}</span><small>{p.human?'انسان':'هوش مصنوعی'}</small></div>)}</div><button className="primary-button" onClick={begin}><Gamepad2 size={18}/> {onlineSocket ? 'شروع بازی آنلاین' : 'شروع بازی'}</button></div> : <div className="control-card"><span className="eyebrow">کنترل بازی</span><h2>{winner!==null?'پایان بازی':players[turn]?.name}</h2><p>{message}</p><div className={`dice-face ${rolling?'shake':''}`}><span>{dice===null?'⚄':['','⚀','⚁','⚂','⚃','⚄','⚅'][dice]}</span></div>{(onlineSocket ? onlineSeat===turn : players[turn]?.human) && gameStarted && winner===null && <button className="primary-button" disabled={rolling||dice!==null} onClick={()=>rollDice()}><Dice5 size={19}/>{rolling?'در حال انداختن تاس...':'انداختن تاس'}</button>}{dice!==null&&(onlineSocket ? onlineSeat===turn : players[turn]?.human)&&movable.length>0&&<small className="hint">یکی از مهره‌های روشن را روی صفحه انتخاب کنید.</small>}{winner!==null&&<button className="primary-button" onClick={begin}><RotateCcw size={18}/> بازی دوباره</button>}<button className="subtle-button" onClick={newInvite}><Share2 size={16}/> دعوت از دوستان</button></div>}
        <div className="mini-stats"><div><Users size={18}/><strong>۴</strong><small>جایگاه بازی</small></div><div><Medal size={18}/><strong>۱۶</strong><small>مهره در میدان</small></div><div><Crown size={18}/><strong>۱</strong><small>قهرمان نهایی</small></div></div>
      </aside>
    </section>
    <section className="features"><div><span className="feature-icon">🎲</span><strong>قانون کلاسیک</strong><small>ورود با شش، حرکت مهره و زدن حریف</small></div><div><span className="feature-icon">🤖</span><strong>هم‌بازی هوشمند</strong><small>از تنهایی تا یک جمع چهارنفره</small></div><div><span className="feature-icon">📲</span><strong>قابل نصب</strong><small>روی موبایل و رایانه، بدون فروشگاه</small></div></section>
    <footer><strong>K-MENCH · بازی منچ باران</strong><span>طراحی و توسعه با احترام به بازی‌های دورهمی ایرانی</span><b>© تمامی حقوق این اثر متعلق به باران عبدی است.</b></footer>
    {showInvite&&<div className="modal-backdrop" onClick={()=>setShowInvite(false)}><div className="invite-modal" onClick={e=>e.stopPropagation()}><button className="close-modal" onClick={()=>setShowInvite(false)}>×</button><div className="invite-symbol"><MessageCircle/></div><span className="eyebrow">دعوت به بازی</span><h2>دوستت رو به منچ باران دعوت کن</h2><p>کد دعوت برای اشتراک‌گذاری آماده شد.</p><div className="invite-code">{inviteCode}</div><button className="primary-button" onClick={shareInvite}><Share2 size={18}/> اشتراک‌گذاری کد و لینک</button><small>از منوی اشتراک‌گذاری گوشی می‌توانید پیامک، واتساپ، تلگرام و دیگر پیام‌رسان‌ها را انتخاب کنید. ارسال پیامک با تأیید خودتان انجام می‌شود.</small></div></div>}
  </main>
}
export default App
