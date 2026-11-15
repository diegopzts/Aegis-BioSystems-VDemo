import {useEffect, useRef, useState, type KeyboardEvent, type PointerEvent} from 'react'
import {CloudRain, Moon, Orbit, Sparkles, Star, Sun} from 'lucide-react'
import {useAmbience} from './ambience'
import type {RelaxCommand} from './contracts'
import './missionExperience.css'

const phases = ['Breathe In', 'Hold', 'Breathe Out']
const symbols = [Moon, Star, Orbit, Sun, CloudRain, Sparkles]
const symbolNames = ['Moon', 'Star', 'Orbit', 'Sun', 'Cloud', 'Sparkles']
const defaults = [{x: 24, y: 40}, {x: 55, y: 28}, {x: 72, y: 70}]
const clamp = (value: number) => Math.min(94, Math.max(6, value))
const shuffle = () => Array.from({length: 12}, (_, i) => ({id: i, symbol: i % 6, order: Math.random()})).sort((a, b) => a.order - b.order)
const activities = ['Breathing Guide', 'Memory Match', 'Zen Orbit'] as const
type Activity = typeof activities[number]

export function RelaxPage({intent, duck, volume, setVolume}: {
  intent?: {command: RelaxCommand; revision: number}; duck: boolean; volume: number; setVolume: (level: number) => void
}) {
  const [activity, setActivity] = useState<Activity>('Breathing Guide')
  const [durations, setDurations] = useState([4, 2, 6])
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const [sound, setSound] = useState('deep_space')
  const [audio, setAudio] = useState<'stopped' | 'paused' | 'playing'>('stopped')
  const [audioAttempt, setAudioAttempt] = useState(0)
  const consumed = useRef(0)
  const ambienceError = useAmbience(`relax-room-${audioAttempt}`, audio === 'playing', false, 0, volume, duck, sound)
  useEffect(() => {
    if (!intent || consumed.current === intent.revision) return
    consumed.current = intent.revision
    switch (intent.command) {
      case 'start_breathing': setActivity('Breathing Guide'); setRunning(true); break
      case 'open_memory': setActivity('Memory Match'); break
      case 'open_zen': setActivity('Zen Orbit'); break
      case 'play_ambient': setAudio('playing'); break
      case 'pause_ambient': setAudio('paused'); break
      case 'stop_ambient': setAudio('stopped'); break
    }
  }, [intent])
  useEffect(() => {
    if (!running || activity !== 'Breathing Guide') return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const delta = now - previous
      previous = now
      setElapsed(time => time + delta)
    }, 100)
    return () => window.clearInterval(timer)
  }, [activity, running])
  const cycle = elapsed / 1000 % durations.reduce((sum, seconds) => sum + seconds)
  const phase = cycle < durations[0] ? 0 : cycle < durations[0] + durations[1] ? 1 : 2
  const phaseTime = cycle - durations.slice(0, phase).reduce((sum, seconds) => sum + seconds, 0)
  const expansion = phase === 0 ? phaseTime / durations[0] : phase === 1 ? 1 : 1 - phaseTime / durations[2]

  return <div className="relax-room">
    <div className="control-strip" aria-label="Wellness activities">{activities.map(name =>
      <button type="button" key={name} className="button" aria-pressed={name === activity} onClick={() => setActivity(name)}>{name}</button>)}</div>
    {activity === 'Breathing Guide' && <section className="panel content-panel relax-activity">
      <h2>Breathing Guide</h2><p className="muted">Follow a comfortable rhythm.</p>
      <div className="relax-breath" style={{transform: `scale(${.82 + .28 * expansion})`}} aria-hidden="true"/>
      <p role="status">{running ? phases[phase] : elapsed ? 'Paused' : 'Ready'}</p>
      <output aria-label="Seconds left in this phase">{Math.ceil(durations[phase] - phaseTime)} s</output>
      <div className="control-strip">
        <button className="button primary" onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Start'}</button>
        <button className="button" onClick={() => {setElapsed(0); setRunning(false)}}>Reset</button>
      </div>
      <div className="relax-durations">{phases.map((label, index) => <label key={label}>{label} (seconds)
        <select disabled={running} value={durations[index]} onChange={event => {
          setElapsed(0)
          setDurations(values => values.map((value, i) => i === index ? Number(event.target.value) : value))
        }}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(seconds => <option key={seconds}>{seconds}</option>)}</select></label>)}</div>
    </section>}
    {activity === 'Memory Match' && <MemoryMatch/>}
    {activity === 'Zen Orbit' && <ZenOrbit/>}
    <section className="panel content-panel relax-audio" aria-label="Ambient audio">
      <h2>Ambient Audio</h2>
      <label>Sound <select value={sound} onChange={event => setSound(event.target.value)}>
        <option value="deep_space">Deep Space Ambient</option><option value="warm_rain">Soft Rain</option>
        <option value="ocean_waves">Ocean Waves</option><option value="dust_wind">Gentle Wind</option><option value="calm_synth">Calm Synth Atmosphere</option>
      </select></label>
      <div className="control-strip">
        <button className="button primary" disabled={audio === 'playing' && !ambienceError} onClick={() => {
          if (ambienceError) setAudioAttempt(value => value + 1)
          setAudio('playing')
        }}>Play</button>
        <button className="button" disabled={audio !== 'playing'} onClick={() => setAudio('paused')}>Pause audio</button>
        <button className="button" disabled={audio === 'stopped'} onClick={() => setAudio('stopped')}>Stop</button>
      </div>
      <label>Volume <input type="range" min="0" max="1" step=".05" value={volume} onChange={event => setVolume(Number(event.target.value))}/></label>
      {ambienceError && <p role="alert">{ambienceError}</p>}
    </section>
  </div>
}

function MemoryMatch() {
  const [cards, setCards] = useState(shuffle)
  const [open, setOpen] = useState<number[]>([])
  const [matches, setMatches] = useState<number[]>([])
  const [moves, setMoves] = useState(0)
  useEffect(() => {
    if (open.length !== 2) return
    const [first, second] = open
    const match = cards[first].symbol === cards[second].symbol
    const timer = window.setTimeout(() => {
      if (match) setMatches(values => [...values, first, second])
      setOpen([])
    }, match ? 180 : 780)
    return () => window.clearTimeout(timer)
  }, [cards, open])
  return <section className="panel content-panel relax-activity">
    <h2>Memory Match</h2><p role="status">{moves} moves · {matches.length / 2} / 6 pairs{matches.length === 12 && ' · Complete'}</p>
    <div className="memory-grid">{cards.map(({id, symbol}, index) => {
      const shown = open.includes(index) || matches.includes(index)
      const Icon = symbols[symbol]
      return <button className="memory-card" type="button" key={id} aria-pressed={shown}
        aria-label={shown ? `Card ${index + 1}, ${symbolNames[symbol]}` : `Card ${index + 1}, face down`}
        disabled={matches.includes(index)} onClick={() => {
          if (open.length === 2 || open.includes(index)) return
          if (open.length === 1) setMoves(value => value + 1)
          setOpen([...open, index])
        }}>{shown ? <Icon aria-hidden="true"/> : <span aria-hidden="true">✦</span>}</button>
    })}</div>
    <button className="button" onClick={() => {setCards(shuffle()); setMoves(0); setOpen([]); setMatches([])}}>Reset game</button>
  </section>
}

function ZenOrbit() {
  const [points, setPoints] = useState(defaults)
  function move(index: number, x: number, y: number) {
    setPoints(values => values.map((point, i) => i === index ? {x: clamp(x), y: clamp(y)} : point))
  }
  function drag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = event.currentTarget.parentElement!.getBoundingClientRect()
    move(index, (event.clientX - rect.left) / rect.width * 100, (event.clientY - rect.top) / rect.height * 100)
  }
  function keyMove(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = {ArrowLeft: [-3, 0], ArrowRight: [3, 0], ArrowUp: [0, -3], ArrowDown: [0, 3]}[event.key]
    if (!direction) return
    event.preventDefault()
    move(index, points[index].x + direction[0], points[index].y + direction[1])
  }
  return <section className="panel content-panel relax-activity">
    <h2>Zen Orbit</h2><p className="muted">Drag the lights or move them with the arrow keys.</p>
    <div className="zen-space">{points.map((point, index) => <button key={index} type="button"
      className="zen-light" aria-label={`Orbital light ${index + 1}`} style={{left: `${point.x}%`, top: `${point.y}%`}}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => drag(event, index)}
      onKeyDown={event => keyMove(event, index)}/>)}</div>
    <button className="button" onClick={() => setPoints(defaults)}>Reset orbit</button>
  </section>
}
