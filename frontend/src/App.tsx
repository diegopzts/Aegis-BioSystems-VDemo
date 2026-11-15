import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Box, ChevronDown, CircleHelp, FlaskConical, HeartHandshake, LayoutDashboard, Menu, Moon, ShieldPlus, Sparkles, UsersRound, Waves, X } from 'lucide-react'
import { post, useResource } from './api'
import { ScenarioBar } from './ScenarioBar'
import { OrbitalSlot, useOrbitalUi } from './orbitalUi'
import { OrbitalMonitor } from './OrbitalMonitor'
import { useOrbitalWelcome } from './orbitalWelcome'
import { simulationSchema, type Simulation, type SituationId } from './simulation'
import { Companion, type CompanionControls, type CompanionVoiceStatus } from './Companion'
import { CheckinPrompt, loadPosition, saveLocal, useCheckinPrompt } from './checkinPrompt'
import { ResourceStatus } from './components'
import { dateLabel, orbitModules, positionSchema, scenarios, type Change, sectionLabels, sections, type Action, type CrewId, type Metric, type Mission, type Region, type RelaxCommand, type Scenario, type Section, type Span, type View } from './contracts'
import { Overview } from './Overview'
import { SleepPage } from './SleepPage'
import { VitalsPage } from './VitalsPage'
import { WellnessPage } from './WellnessPage'

const BodyPage = lazy(() => import('./BodyPage').then(module => ({default: module.BodyPage})))
const CrewPage = lazy(() => import('./CrewPage').then(module => ({default: module.CrewPage})))
const RelaxPage = lazy(() => import('./RelaxPage').then(module => ({default: module.RelaxPage})))
const navIcons = {overview: LayoutDashboard, vitals: Activity, sleep: Moon, wellness: HeartHandshake, body: Box, crew: UsersRound, relax: Waves}
const subtitles: Record<Section, string> = {
  overview: 'Crew health and wellbeing across the Mars transit.',
  vitals: 'Explore the live training monitor and the separate simulated mission history.',
  sleep: 'Explore 30 mission nights, sleep timing and recovery patterns.',
  wellness: 'Track how you feel and make room for recovery.',
  body: 'Explore the anatomical model and view simulated mission telemetry separately.',
  crew: 'Mission Crew Health & Status',
  relax: 'Your Space to Reset, Recharge & Relax',
}

export function App() {
  const orbitalUi = useOrbitalUi()
  const welcome = useOrbitalWelcome()
  const [orbitalMounted, setOrbitalMounted] = useState(false)
  const [orbitalFocused, setOrbitalFocused] = useState(false)
  const [orbitalSelection, setOrbitalSelection] = useState(0)
  const [section, setSection] = useState<Section>('overview')
  const [crewId, setCrewId] = useState<CrewId>('AST-01')
  const [relaxIntent, setRelaxIntent] = useState<{command: RelaxCommand; revision: number}>()
  const relaxRevision = useRef(0)
  const [relaxVolume, setRelaxVolume] = useState(.4)
  const [context, setContext] = useState(loadPosition)
  const {scenario, day} = context
  const [metric, setMetric] = useState<Metric>('heartRate')
  const [span, setSpan] = useState<Span>('7d')
  const [night, setNight] = useState<number>()
  const [region, setRegion] = useState<Region>('full')
  const [view, setOrientation] = useState<View>('front')
  const [cameraRevision, setCameraRevision] = useState(0)
  const [wellnessRevision, setWellnessRevision] = useState(0)
  const [companion, setCompanion] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const openCompanion = () => { setEverOpened(true); setCompanion(true) }
  const companionControls = useRef<CompanionControls>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [simulation, setSimulation] = useState<Simulation>()
  const [activating, setActivating] = useState<SituationId>()
  const [simulationError, setSimulationError] = useState('')
  const [breathingEvent, setBreathingEvent] = useState<string>()
  const [fullWorkspace, setFullWorkspace] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<CompanionVoiceStatus>({label: 'Voice disconnected', playing: false, state: 'disconnected', output: 0})
  const simulationLoad = useResource<unknown>('simulation')
  const mutation = useRef(false)
  const lastEvent = useRef('')
  const syncSimulation = useCallback((value: Simulation) => {
    setSimulation(previous => !previous || value.version >= previous.version ? value : previous)
  }, [])
  useEffect(() => {
    const parsed = simulationSchema.safeParse(simulationLoad.data)
    if (parsed.success) syncSimulation(parsed.data)
  }, [simulationLoad.data, syncSimulation])
  useEffect(() => {
    if (lastEvent.current !== simulation?.event_id) { lastEvent.current = simulation?.event_id ?? ''; setFullWorkspace(false) }
  }, [simulation?.event_id])
  async function activateSituation(id: SituationId) {
    if (mutation.current) return
    mutation.current = true
    setActivating(id)
    setSimulationError('')
    try {
      const event_id = crypto.randomUUID()
      syncSimulation(simulationSchema.parse(await post(id === 'nominal' ? 'simulation/nominal/reset' : `simulation/${id}`, {event_id})))
    } catch {
      setSimulationError('The change could not be confirmed. Try again when FastAPI is available.')
    } finally { mutation.current = false; setActivating(undefined) }
  }
  const companionTrigger = useRef<HTMLButtonElement>(null)
  const mission = useResource<Mission>(`mission?scenario=${scenario}&day=${day}`, wellnessRevision + (simulation?.version ?? 0), true)
  const checkin = useCheckinPrompt(day, Boolean(mission.data))
  useEffect(() => { saveLocal('aegis-mission-v1', context) }, [context])
  const health = useResource<{status: string; geminiStatus: 'configured' | 'unconfigured'}>('health')
  const navigate = useCallback((next: Section) => {
    setOrbitalFocused(true)
    setOrbitalSelection(orbitModules.indexOf(next))
    if (next !== 'relax') setRelaxIntent(undefined)
    setSection(next)
    setMobileNav(false)
    window.scrollTo(0, 0)
  }, [])
  const returnToOrbit = useCallback(() => {
    setOrbitalFocused(false)
    setRelaxIntent(undefined)
    setMobileNav(false)
    window.scrollTo(0, 0)
  }, [])
  const setView = useCallback((orientation: View) => {
    setOrientation(orientation)
    setCameraRevision(value => value + 1)
  }, [])
  const onActions = useCallback((actions: Action[]) => {
    for (const action of actions) {
      switch (action.type) {
        case 'navigate': navigate(action.section); break
        case 'chart': setMetric(action.metric); setSpan(action.range); navigate('vitals'); break
        case 'viewer': setRegion(action.region); setView(action.view); navigate('body'); break
        case 'relax': navigate('relax'); setRelaxIntent({command: action.command, revision: ++relaxRevision.current}); break
        case 'crew': setCrewId(action.crewId); navigate('crew'); break
        case 'orbit': returnToOrbit(); break
      }
    }
  }, [navigate, returnToOrbit, setView])
  const current = mission.data
  function applyChange(change: Change) {
    if (change.refresh === 'mission') {
      const position = positionSchema.parse(change.record)
      setContext(position)
      setNight(undefined)
    } else {
      setWellnessRevision(value => value + 1)
    }
  }
  function closeCompanion() {
    setCompanion(false)
    companionTrigger.current?.focus()
  }
  function openNight(day: number) { setNight(day); navigate('sleep') }
  function openMetric(value: Metric) { setMetric(value); navigate('vitals') }
  function startAssistant(retry = false) {
    openCompanion()
    companionControls.current?.startFromOrbit(() => welcome.play(retry))
  }
  function openOrbitalModule(module: Section | 'companion') {
    if (module === 'companion') {
      setOrbitalFocused(true)
      setMobileNav(false)
      openCompanion()
    } else navigate(module)
  }

  const zero = simulation?.active_mode === 'zero_ui' && !fullWorkspace
  const orbital = orbitalUi.orbital && orbitalMounted
  const breathing = Boolean(simulation?.event_id && breathingEvent === simulation.event_id)
  return <div className="app-shell" data-companion-open={companion} data-aegis-mode={simulation?.active_mode ?? 'standard'}
    data-aegis-situation={simulation?.scenario_id ?? 'nominal'} data-aegis-focus={zero ? 'zero' : undefined}>
    <a className="skip-link" href="#mission-content">Skip to mission content</a>
    {mobileNav && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <button className="brand" onClick={() => orbital ? returnToOrbit() : navigate('overview')} aria-label="AEGIS BioSystems home">
        <span className="brand-mark"><ShieldPlus size={24}/></span><span><strong>AEGIS</strong><small>BIOSYSTEMS</small></span>
      </button>
      <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMobileNav(false)}><X size={17}/></button>
      <nav aria-label="Mission navigation"><div className="nav-label">Mission workspace</div>
        {sections.map(key => {
          const Icon = navIcons[key]
          return <button key={key} className={`nav-item ${section === key ? 'selected' : ''}`}
            aria-current={section === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={18}/>{sectionLabels[key]}</button>
        })}
        <button className={`nav-item ${companion ? 'selected' : ''}`} aria-expanded={companion}
          onClick={() => {if (companion) closeCompanion(); else openCompanion(); setMobileNav(false)}}><Sparkles size={18}/> AI Companion</button>
      </nav>
      <div className="sidebar-footer">
        <span><CircleHelp size={15}/> Educational simulation</span>
        <small>Synthetic data · for demonstration</small>
      </div>
    </aside>
    <div className={`workspace ${companion ? 'with-companion' : ''}`}>
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}><Menu size={20}/></button>
        <span className="topbar-title">AEGIS <span>BioSystems</span></span>
        <div className="topbar-right">
          <select className="experience-select" aria-label="Visual experience" disabled={orbitalUi.urlClassic}
            value={orbitalUi.preferredClassic ? 'classic' : 'auto'}
            onChange={event => orbitalUi.setPreference(event.target.value === 'classic')}>
            <option value="auto">Automatic</option>
            <option value="classic">Classic</option>
          </select>
          <span className={`system-state ${health.error ? 'irregular' : ''}`}><i/>{health.data ? 'System online' : health.error ? 'API offline' : 'Connecting'}</span>
          {current && <span className="day-chip">MD <strong>{String(current.day).padStart(2, '0')}</strong></span>}
          {current && <div className="crew"><span className="crew-avatar">MC</span><div><strong>{current.name}</strong><small>{current.role}</small></div></div>}
          <button className="button assistant-trigger" ref={companionTrigger} onClick={() => companion ? closeCompanion() : openCompanion()} aria-expanded={companion} aria-label="AEGIS AI Companion">
            <Sparkles size={16}/> <span>Companion</span>
          </button>
        </div>
        <div className="classic-orbital-monitor" hidden={orbital}>
          <OrbitalMonitor orbital={simulation?.orbital} day={simulation?.mission_day ?? current?.day} plannedDays={current?.plannedDays}/>
        </div>
      </header>
      <main id="mission-content" className="main-content">
        <OrbitalSlot enabled={orbitalUi.orbital} failed={orbitalUi.failed}
          orbital={simulation?.orbital} day={simulation?.mission_day ?? current?.day} plannedDays={current?.plannedDays}
          focused={orbitalFocused} selection={orbitalSelection} select={setOrbitalSelection} onMounted={setOrbitalMounted}
          open={openOrbitalModule} back={returnToOrbit} startAssistant={() => startAssistant()} retryWelcome={() => startAssistant(true)}
          welcome={welcome.status} voice={voiceStatus} breathing={breathing} alert={Boolean(simulation && simulation.scenario_id !== 'nominal')}/>
        <ScenarioBar snapshot={simulation} busy={activating} error={simulationError || (simulationLoad.error ? 'Could not load the simulation status.' : '')}
          activate={id => void activateSituation(id)} heartRate={current?.metrics.heartRate.value} playing={voiceStatus.playing}
          voiceStatus={voiceStatus.label} graph={voiceStatus.graph} onBreathing={setBreathingEvent} openVoice={openCompanion} useWorkspace={() => setFullWorkspace(current => !current)}/>
        <div className="mission-widgets" hidden={zero || (orbital && !orbitalFocused)}>
        <header className="page-heading">
          <div><div className="eyebrow"><span className="section-path">Mission Health Console</span>{current && <span> / {dateLabel(current.date)}</span>}</div>
            <h1>{sectionLabels[section]}</h1><p>{subtitles[section]}</p></div>
          <label className="scenario"><FlaskConical size={16}/><span>Scenario</span>
            <select aria-label="Simulation scenario" value={scenario} onChange={event => {setContext({...context, scenario: event.target.value as Scenario}); setNight(undefined)}}>
              {Object.entries(scenarios).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select><ChevronDown size={14}/></label>
        </header>
        {current && checkin.visible && !companion && <CheckinPrompt mission={current} metrics={checkin.settings.metrics}
          dismiss={checkin.dismiss} open={() => {checkin.dismiss(); openCompanion()}}/>}
        {section === 'overview' && (current ? <Overview mission={current} navigate={navigate} openMetric={openMetric} openNight={openNight}/> :
          <ResourceStatus error={mission.error} retry={mission.retry}/>)}
        {section === 'vitals' && <VitalsPage scenario={scenario} day={day} revision={simulation?.version ?? 0} metric={metric} span={span} setMetric={setMetric} setSpan={setSpan}/>}
        {section === 'sleep' && <SleepPage key={`${scenario}-${day}`} scenario={scenario} day={day} revision={wellnessRevision} selectedDay={night} select={setNight}/>}
        {section === 'wellness' && <WellnessPage key={`${scenario}-${day}`} scenario={scenario} day={day} revision={wellnessRevision} onSave={() => setWellnessRevision(value => value + 1)}/>}
        {section === 'body' && (current ? <Suspense fallback={<ResourceStatus retry={() => {}}/>}>
          <BodyPage mission={current} region={region} view={view} revision={cameraRevision} setRegion={setRegion} setView={setView}/>
        </Suspense> : <ResourceStatus error={mission.error} retry={mission.retry}/>)}
        {section === 'crew' && <Suspense fallback={<ResourceStatus retry={() => {}}/>}>
          <CrewPage scenario={scenario} day={day} revision={simulation?.version ?? 0} selected={crewId} select={setCrewId}/>
        </Suspense>}
        {section === 'relax' && !zero && (!orbital || orbitalFocused) && <Suspense fallback={<ResourceStatus retry={() => {}}/>}>
          <RelaxPage intent={relaxIntent} duck={voiceStatus.playing} volume={relaxVolume} setVolume={setRelaxVolume}/>
        </Suspense>}
        <footer className="main-footer"><span>Beyond Monitoring. Towards Prevention.</span><span>Educational demo · Use qualified human support for medical decisions.</span></footer>
        </div>
      </main>
    </div>
    {(everOpened || orbitalUi.orbital) && <Companion ref={companionControls} orbital={orbital} waitForWelcome={welcome.wait}
      visible={companion} breathing={breathing} simulation={simulation} onSimulation={syncSimulation} onVoiceStatus={setVoiceStatus} context={context} ui={{section, metric, range: span, region, view, crewId}} availability={health.error ? 'error' : health.data?.geminiStatus ?? 'checking'}
      onActions={onActions} onChange={applyChange} close={closeCompanion} checkin={checkin}/>}
  </div>
}
