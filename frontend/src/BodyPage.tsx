import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from 'react'
import {Box, Maximize, Minus, Plus, RotateCcw, UserRound} from 'lucide-react'
import {SectionTitle} from './components'
import {COL, CSS, LBL, habitats, practiceData, zoneLabels, zones, type Habitat, type Zone} from './anatomyPractice'
import {mountAnatomy, type Layer, type ModelState} from './anatomyScene'
import {metricLabels, regionLabels, regions, views, type Metric, type Mission, type Region, type View} from './contracts'

const regionMetrics: Record<Region, Metric[]> = {
  full: ['temperature', 'heartRate', 'spo2', 'sleepHours'], head: ['sleepHours'], chest: ['heartRate', 'spo2'], limbs: ['temperature'],
}
const regionFor: Record<Zone, Region> = {cabeza: 'head', pecho: 'chest', abdomen: 'full', brazos: 'limbs', piernas: 'limbs'}
const zonesFor: Record<Region, Zone[]> = {full: [], head: ['cabeza'], chest: ['pecho'], limbs: ['brazos', 'piernas']}
const pointsFor: Record<Region, number[]> = {full: [0, 2, 0, 9], head: [0, 3.6, 0, 2.4], chest: [0, 2.7, 0, 3.2], limbs: [0, 1.45, 0, 6]}
const labels: Record<Layer, string> = {muscle: 'Muscles', support: 'Supporting structures', organs: 'Organs'}
const rank = {verde: 0, amarillo: 1, rojo: 2}

function Trend({history, value, color}: {history: number[]; value: number; color: string}) {
  const entries = [...history, value]
  const low = Math.min(...entries), span = Math.max(...entries) - low || 1
  const points = entries.map((entry, index) => [6 + 188 * index / (entries.length - 1), 48 - 40 * (entry - low) / span])
  const [lastX, lastY] = points[points.length - 1]
  return <svg viewBox="0 0 200 54" role="img" aria-label={`Last seven synthetic values: ${entries.join(', ')}`} preserveAspectRatio="none">
    <polyline points={points.map(point => point.join(',')).join(' ')} stroke={color} strokeWidth={2} fill="none" vectorEffect="non-scaling-stroke"/>
    <circle cx={lastX} cy={lastY} r={3} fill={color}/>
  </svg>
}

export function BodyPage({mission, region, view, revision, setRegion, setView}: {
  mission: Mission; region: Region; view: View; revision: number; setRegion: (region: Region) => void; setView: (view: View) => void
}) {
  const scene = useRef<ReturnType<typeof mountAnatomy> | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const regionInfo = useRef<HTMLDivElement>(null)
  const [model, setModel] = useState<ModelState>({status: 'loading', layers: []})
  const [layer, setLayer] = useState<Layer>('muscle')
  const [stress, setStress] = useState(35)
  const [habitat, setHabitat] = useState<Habitat>('nave')
  const [open, setOpen] = useState<Zone[]>(zonesFor[region])
  const [rotating, setRotating] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const [fullscreenError, setFullscreenError] = useState(false)
  const data = useMemo(() => practiceData(stress, habitat), [stress, habitat])
  const worst = zones.reduce((a, zone) => rank[data[zone].tone] > rank[a] ? data[zone].tone : a, 'verde' as keyof typeof rank)
  const pick = useRef<(zone: Zone) => void>(() => {})
  const lastPose = useRef<{revision: number; view: View} | null>(null)
  const report = useCallback((state: ModelState) => {
    setModel(state)
    if (state.status === 'ready' && !state.detail) setLayer(state.layers.includes('muscle') ? 'muscle' : state.layers[0])
  }, [])

  useEffect(() => {
    if (!canvas.current) return
    lastPose.current = null
    try {
      scene.current = mountAnatomy(canvas.current, report, zone => pick.current(zone))
    } catch {
      setModel({status: 'error', layers: [], detail: 'WebGL 2 is unavailable. You can still explore the region panel.'})
    }
    return () => { scene.current?.dispose(); scene.current = null }
  }, [report])
  // The validated AEGIS viewer action changes region and camera revision together.
  useEffect(() => {
    if (lastPose.current?.revision === revision && lastPose.current.view === view) return
    if (lastPose.current || revision || region !== 'full' || view !== 'front') {
      setOpen(zonesFor[region])
      scene.current?.focus(pointsFor[region], view)
      setRotating(false)
    }
    lastPose.current = {revision, view}
    // A canvas pick changes the shared coarse region without requesting a new camera pose.
  }, [revision, view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    scene.current?.highlight(open.reduce((mask, zone) => mask | (1 << zones.indexOf(zone)), 0),
      zones.map(zone => COL[data[zone].tone]))
  }, [data, open])
  useEffect(() => {
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    function respectMotion() { if (motion?.matches) setRotating(false) }
    motion?.addEventListener('change', respectMotion)
    return () => motion?.removeEventListener('change', respectMotion)
  }, [])

  function focus(target: Zone) {
    setOpen(previous => [target, ...previous.filter(zone => zone !== target)])
    setRegion(regionFor[target])
    scene.current?.focus(data[target].f)
    setRotating(false)
    if (regionInfo.current) regionInfo.current.scrollTop = 0
  }
  useEffect(() => { pick.current = focus })
  function chooseRegion(next: Region) {
    setRegion(next)
    setOpen(zonesFor[next])
    scene.current?.focus(pointsFor[next])
    setRotating(false)
  }
  function closeZone(zone: Zone) {
    const remaining = open.filter(value => value !== zone)
    setOpen(remaining)
    setRegion(remaining.length ? regionFor[remaining[0]] : 'full')
    if (!remaining.length) scene.current?.focus(pointsFor.full)
  }
  function reset() {
    setRegion('full')
    setView('front')
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement === stage.current) await document.exitFullscreen()
      else if (stage.current?.requestFullscreen) await stage.current.requestFullscreen()
      else throw Error('Fullscreen unavailable')
      setFullscreenError(false)
    } catch { setFullscreenError(true) }
  }

  return <div className="anatomy-layout">
    <section className="panel content-panel anatomy-viewer">
      <SectionTitle icon={<Box size={19}/>} title="Crew Model" subtitle="Educational anatomy model · Drag to orbit and scroll to zoom"
        action={<button className="button" onClick={reset}><RotateCcw size={15}/> Reset view</button>}/>
      <div className="control-strip anatomy-toolbar" aria-label="Herramientas del visor">
        <button className="button" aria-pressed={rotating} disabled={!scene.current} onClick={() => {
          scene.current?.rotate(!rotating); setRotating(!rotating)
        }}>Auto-rotate</button>
        <button className="button" aria-label="Zoom in" disabled={!scene.current} onClick={() => scene.current?.zoom(.8)}><Plus size={16}/></button>
        <button className="button" aria-label="Zoom out" disabled={!scene.current} onClick={() => scene.current?.zoom(1.25)}><Minus size={16}/></button>
        <label className="button anatomy-file">Load model
          <input type="file" accept=".glb,.gltf" disabled={!scene.current} onChange={event => {
            const file = event.currentTarget.files?.[0]
            if (file) void scene.current?.load(file)
            event.currentTarget.value = ''
          }}/>
        </label>
        <button className="button" aria-label="Full screen" onClick={() => void fullscreen()}><Maximize size={16}/></button>
      </div>
      {fullscreenError && <p className="muted" role="status">Full screen is unavailable in this browser.</p>}
      <div ref={stage} className="anatomy-stage">
        <canvas ref={canvas} aria-label="3D anatomy model" data-model-status={model.status}/>
        {model.status !== 'ready' && <div className="anatomy-status" role="status">
          {model.status === 'loading' ? 'Loading the anatomy model…' : model.detail}
          {model.status === 'error' && scene.current && <button className="button" onClick={() => void scene.current?.load()}>Retry</button>}
        </div>}
        <button className="button anatomy-exit" onClick={() => void fullscreen()}>Exit full screen</button>
      </div>
      {model.status === 'ready' && model.detail && <p role="status" className="muted">{model.detail}</p>}
      {model.layers.length > 1 && <div className="control-strip anatomy-toolbar" aria-label="Model layers">
        {(Object.keys(labels) as Layer[]).filter(item => model.layers.includes(item)).map(item =>
          <button key={item} className="button" aria-pressed={layer === item} onClick={() => {
            scene.current?.setLayer(item); setLayer(item)
          }}>{labels[item]}</button>)}
      </div>}
      {layer === 'support' && <p className="muted">Filters model meshes by name. The skeleton is incomplete.</p>}
      <div className="control-strip anatomy-toolbar" aria-label="Camera orientation">{views.map(value =>
        <button key={value} className="button capitalize" aria-pressed={view === value} onClick={() => setView(value)}>{value}</button>)}</div>
    </section>
    <aside className="panel content-panel anatomy-info">
      <SectionTitle icon={<UserRound size={19}/>} title="Body Regions" subtitle="Model regions and training data"/>
      <div className="region-tabs" aria-label="Body regions">{regions.map(key => <button key={key} className="button" aria-pressed={key === region} onClick={() => chooseRegion(key)}>{regionLabels[key]}</button>)}</div>
      <div className="region-tabs" aria-label="Anatomical regions">{zones.map(zone =>
        <button key={zone} aria-label={`${zoneLabels[zone]} training region`} className="button anatomy-zone" aria-pressed={open.includes(zone)} onClick={() => focus(zone)}>
          <span aria-hidden="true" style={{background: CSS[data[zone].tone]}}/>{zoneLabels[zone]}
        </button>)}</div>
      <div className="anatomy-practice">
        <p className="muted">Training exercise · Separate synthetic data</p>
        <label>Training scenario
          <select value={habitat} onChange={event => setHabitat(event.target.value as Habitat)}>
            {(Object.keys(habitats) as Habitat[]).map(key => <option key={key} value={key}>{habitats[key]}</option>)}
          </select>
        </label>
        <label>Simulate stress <output>{stress} %</output>
          <input type="range" min="0" max="100" value={stress} onChange={event => setStress(event.target.valueAsNumber)}/>
        </label>
        <p className="muted">Training status: <b style={{color: CSS[worst]}}>{LBL[worst]}</b> · Pulse {data.pecho.value} bpm · SpO₂ 97 % · HRV {data.cabeza.value} ms</p>
      </div>
      <div ref={regionInfo} className="anatomy-details">
        {!open.length ? <p className="muted">Select a region on the model or use the buttons. Colors show the training status.</p> :
          <div className="anatomy-card-list">
            {open.length > 1 && <button className="button" onClick={() => chooseRegion('full')}>Close all</button>}
            {open.map((zone, index) => {
              const entry = data[zone]
              return <article key={zone} className="anatomy-card" data-active={index === 0} style={{'--zone-color': CSS[entry.tone]} as CSSProperties}>
                <header><h3>{entry.n}</h3><button className="button" aria-label={`Close ${entry.n}`} onClick={() => closeZone(zone)}>×</button></header>
                <p><strong>{entry.value} {entry.u}</strong> · {entry.lbl} · {LBL[entry.tone]}</p>
                <p className="muted">{entry.base}</p>
                <Trend history={entry.hist} value={entry.value} color={CSS[entry.tone]}/>
                <p className="muted">Last 7 days · Simulation</p>
                {entry.tone === 'rojo' && <p>Training alert.</p>}
                <details open><summary>Why is it measured?</summary><p>{entry.why}</p></details>
                <details><summary>How does space affect it?</summary><p>{entry.esp}</p></details>
                <details><summary>When does it need attention?</summary><p>{entry.alarma}</p></details>
                <details open><summary>What can you do in training?</summary><ul>{entry.tips.map(tip => <li key={tip}>{tip}</li>)}</ul></details>
              </article>
            })}
          </div>}
      </div>
      <details className="anatomy-telemetry">
        <summary>Simulated AEGIS telemetry · {regionLabels[region]}</summary>
        <dl className="detail-list">{regionMetrics[region].map(metric => <div key={metric}><dt>{metricLabels[metric]}</dt>
          <dd>{mission.metrics[metric].value} {mission.metrics[metric].unit}</dd></div>)}
          {region === 'head' && <div><dt>Mood</dt><dd>{mission.wellness.mood}/5</dd></div>}
        </dl>
      </details>
    </aside>
  </div>
}
