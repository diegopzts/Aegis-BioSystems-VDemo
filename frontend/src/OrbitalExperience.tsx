import { useEffect, useRef, type ComponentProps, type CSSProperties, type PointerEvent } from 'react'
import { Activity, ArrowLeft, Box, ChevronLeft, ChevronRight, HeartHandshake, LayoutDashboard, Moon, Orbit, Sparkles, UsersRound, Waves } from 'lucide-react'
import { OrbitalMonitor } from './OrbitalMonitor'
import { VoiceOrb } from './VoiceOrb'
import { welcomeText } from './orbitalWelcome'
import type { CompanionVoiceStatus } from './Companion'
import {orbitModules, sectionLabels, type Section} from './contracts'
import './orbital.css'

const icons = {overview: LayoutDashboard, vitals: Activity, sleep: Moon, wellness: HeartHandshake,
  body: Box, companion: Sparkles, crew: UsersRound, relax: Waves}
const shortLabels = {overview: 'Mission', vitals: 'Vitals', sleep: 'Sleep', wellness: 'Wellness',
  body: 'BioSystems 3D', companion: 'AI Companion', crew: 'Crew', relax: 'Relax Room'}
const nodes = orbitModules.map(id => ({id, label: id === 'companion' ? 'AI Companion' : sectionLabels[id], icon: icons[id]}))

type Props = ComponentProps<typeof OrbitalMonitor> & {
  focused: boolean; selection: number; select: (index: number) => void;
  open: (module: Section | 'companion') => void; back: () => void;
  startAssistant: () => void; retryWelcome: () => void; welcome: string;
  voice: CompanionVoiceStatus; breathing: boolean; alert: boolean;
  onMounted: (value: boolean) => void;
}
const wrap = (index: number) => (index + nodes.length) % nodes.length

export default function OrbitalExperience({orbital, day, plannedDays, focused, selection, select, open, back,
  startAssistant, retryWelcome, welcome, voice, breathing, alert, onMounted}: Props) {
  const belt = useRef<HTMLDivElement>(null)
  const nodeButtons = useRef<(HTMLButtonElement | null)[]>([])
  const drag = useRef<{id: number; x: number; moved: boolean} | null>(null)
  const dragged = useRef(false)
  const wheelAt = useRef(0)
  const wasFocused = useRef(false)
  useEffect(() => {
    onMounted(true)
    return () => onMounted(false)
  }, [onMounted])

  useEffect(() => {
    if (focused || !belt.current) return
    const region = belt.current
    function onWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      event.preventDefault()
      const now = performance.now()
      if (now < wheelAt.current) return
      wheelAt.current = now + 245
      select(wrap(selection + Math.sign(delta)))
    }
    region.addEventListener('wheel', onWheel, {passive: false})
    return () => region.removeEventListener('wheel', onWheel)
  }, [focused, selection, select])

  useEffect(() => {
    if (wasFocused.current && !focused) nodeButtons.current[selection]?.focus({preventScroll: true})
    wasFocused.current = focused
  }, [focused, selection])

  function move(direction: number, focus = false) {
    const next = wrap(selection + direction)
    select(next)
    if (focus) nodeButtons.current[next]?.focus()
    else if (window.matchMedia?.('(max-width: 760px)').matches) {
      nodeButtons.current[next]?.scrollIntoView?.({block: 'nearest', inline: 'nearest', behavior: 'instant'})
    }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current
    if (!gesture || event.pointerId !== gesture.id || Math.abs(event.clientX - gesture.x) < 38) return
    if (!gesture.moved) {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      gesture.moved = dragged.current = true
    }
    const direction = event.clientX < gesture.x ? 1 : -1
    gesture.x = event.clientX
    move(direction)
  }

  const busy = voice.state !== 'disconnected' && voice.state !== 'error'
  return <section className={`orbital-experience ${focused ? 'orbital-focus' : 'orbital-home'}`} aria-labelledby="orbital-experience-title">
    <header className="orbital-experience-header">
      <h2 id="orbital-experience-title"><Orbit size={20} aria-hidden="true"/> Orbital view</h2>
      {focused ? <button className="button" type="button" onClick={back}><ArrowLeft size={16}/> Return to Orbit</button>
        : day !== undefined && <p>Mission day <strong>{day}{plannedDays ? ` / ${plannedDays}` : ''}</strong></p>}
    </header>
    {!focused && <div className="orbit-guide">
      <button className="icon-button" type="button" aria-label="Previous module" onClick={() => move(-1)}><ChevronLeft size={19}/></button>
      <div><p aria-live="polite">{nodes[selection].label} <small>{selection + 1} / {nodes.length}</small></p>
        <small>Scroll, drag the orbit, or use the arrow keys.</small></div>
      <button className="icon-button" type="button" aria-label="Next module" onClick={() => move(1)}><ChevronRight size={19}/></button>
    </div>}
    <div className="orbit-stage">
      <div className="orbit-belt" ref={belt} hidden={focused} aria-label="Orbiting modules"
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return
          dragged.current = false
          drag.current = {id: event.pointerId, x: event.clientX, moved: false}
        }}
        onPointerMove={moveDrag}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onLostPointerCapture={() => { drag.current = null }}
        onClickCapture={event => {
          if (dragged.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation() }
          dragged.current = false
        }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          move(event.key === 'ArrowRight' ? 1 : -1, true)
        }}>
        <div className="orbit-trail" aria-hidden="true"/>
        {nodes.map(({id, label, icon: Icon}, index) => {
          const angle = ((index - selection) * Math.PI * 2) / nodes.length + Math.PI / 8
          const position = {'--node-x': `${50 + Math.sin(angle) * 40}%`,
            '--node-y': `${49 + Math.cos(angle) * 43}%`,
            '--node-mobile-y': `${43 + Math.cos(angle) * 36}%`,
            '--node-depth': (Math.cos(angle) + 1) / 2} as CSSProperties
          return <button type="button" key={id} className="orbit-node" ref={element => { nodeButtons.current[index] = element }}
            style={position} tabIndex={selection === index ? 0 : -1} aria-current={selection === index ? 'true' : undefined}
            aria-label={label} onClick={() => { select(index); open(id) }}>
            <span className="orbit-moon" aria-hidden="true"><Icon size={20}/></span><span>{shortLabels[id]}</span>
          </button>
        })}
      </div>
      <div className="orbit-pilot">
        <VoiceOrb graph={voice.graph} label={voice.label} state={voice.state} output={voice.output}
          breathing={breathing} alert={alert} stellar/>
        <button className="orbit-assistant button primary" type="button" onClick={startAssistant}>
          <Sparkles size={16} aria-hidden="true"/> {busy ? 'Open assistant' : 'Start assistant'}
        </button>
        {welcome !== 'idle' && <p className="orbit-welcome" role="status">{welcomeText}</p>}
        {welcome === 'blocked' && !busy && <button className="button" type="button" onClick={retryWelcome}>Enable narration</button>}
        {welcome === 'blocked' && busy && <small>Narration is blocked. Stop voice to retry.</small>}
      </div>
    </div>
    <OrbitalMonitor orbital={orbital} day={day} plannedDays={plannedDays}/>
  </section>
}
