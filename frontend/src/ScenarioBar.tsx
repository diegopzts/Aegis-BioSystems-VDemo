import { useEffect, useState } from 'react'
import { useAmbience } from './ambience'
import { BreathingTrack } from './BreathingTrack'
import { situationIds, type InputGraph, type Simulation, type SituationId } from './simulation'

const labels: Record<SituationId, string> = {
  panic_bio_sync: 'Crisis de Pánico', o2_leak_zero_ui: 'Fuga de O₂', extreme_isolation: 'Aislamiento Extremo',
  mars_murphy: 'Mars Murphy’s Law', nominal: '↺ Restaurar Nominal',
}

function AcousticProxy({graph}: {graph?: InputGraph}) {
  const [series, setSeries] = useState<number[]>([])
  useEffect(() => {
    if (!graph) return
    const analyser = graph.context.createAnalyser()
    analyser.fftSize = 512
    graph.input.connect(analyser)
    const sample = new Float32Array(analyser.fftSize)
    let frame: number
    let last = -Infinity
    function measure(now: number) {
      if (now - last >= 140) {
        last = now
        analyser.getFloatTimeDomainData(sample)
        let squares = 0
        for (const value of sample) squares += value * value
        const rms = Math.sqrt(squares / sample.length)
        setSeries(previous => [...previous.slice(-39), rms])
      }
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(frame)
      try { graph.input.disconnect(analyser) } catch { /* The voice session may already be disconnected. */ }
      analyser.disconnect()
    }
  }, [graph])
  return <div className="acoustic-proxy">
    <strong>Actividad vocal estimada · no mide emociones ni estrés clínico</strong>
    <p>Proxy acústico experimental calculado en este navegador.</p>
    {graph ? <svg role="img" aria-label="Energía RMS de la señal local" viewBox="0 0 200 36" preserveAspectRatio="none">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={series.map((value, index) =>
        `${index * 5},${34 - Math.min(1, value * 5) * 32}`).join(' ')}/></svg> :
      <p>Disponible cuando inicias voz y autorizas el micrófono.</p>}
  </div>
}

export function ScenarioBar({snapshot, busy, error, activate, heartRate, playing, voiceStatus, graph, openVoice, useWorkspace, onBreathing}: {
  snapshot?: Simulation; busy?: SituationId; error: string; activate: (id: SituationId) => void;
  heartRate?: number; playing: boolean; voiceStatus: string; graph?: InputGraph; openVoice: () => void; useWorkspace: () => void; onBreathing?: (eventId?: string) => void
}) {
  return <section className="panel scenario-bar" aria-label="Simular Situación">
    <strong>Simular Situación:</strong>
    <div className="button-group">{situationIds.map(id =>
      <button type="button" className="button" key={id} disabled={Boolean(busy)}
        aria-pressed={snapshot?.scenario_id === id} onClick={() => activate(id)}>{labels[id]}</button>)}</div>
    <p className="muted">Demo con datos sintéticos. No controla hardware ni ofrece diagnóstico médico</p>
    <p role="status">{busy ? 'Activando situación…' : snapshot?.scenario_id === 'nominal' ? 'Situación nominal activa' : !snapshot ? 'Cargando situación…' : ''}</p>
    {error && <p role="alert" className="inline-warning">{error}</p>}
    {snapshot && snapshot.scenario_id !== 'nominal' &&
      <ScenarioDetails key={snapshot.event_id} snapshot={snapshot} heartRate={heartRate} playing={playing}
        voiceStatus={voiceStatus} graph={graph} openVoice={openVoice} useWorkspace={useWorkspace} onBreathing={onBreathing}/>}
  </section>
}

function ScenarioDetails({snapshot, heartRate, playing, voiceStatus, graph, openVoice, useWorkspace, onBreathing}: {
  snapshot: Simulation; heartRate?: number; playing: boolean; voiceStatus: string; graph?: InputGraph;
  openVoice: () => void; useWorkspace: () => void; onBreathing?: (eventId?: string) => void
}) {
  const [guide, setGuide] = useState(snapshot.breathing_guide)
  const [hidden, setHidden] = useState(false)
  const [epoch, setEpoch] = useState(() => Date.now())
  const [pausedAt, setPausedAt] = useState(0)
  function toggleGuide() {
    if (guide) setPausedAt(Date.now() - epoch)
    else setEpoch(Date.now() - pausedAt)
    setGuide(!guide)
  }
  const [ambient, setAmbient] = useState(false)
  const [volume, setVolume] = useState(.28)
  const {habitat} = snapshot
  const breathing = snapshot.breathing_guide && guide && !hidden
  useEffect(() => {
    onBreathing?.(breathing ? snapshot.event_id : undefined)
    return () => onBreathing?.(undefined)
  }, [breathing, onBreathing, snapshot.event_id])
  const ambientError = useAmbience(snapshot.event_id, ambient, breathing, epoch, volume, playing, snapshot.ambience)
  const zero = snapshot.active_mode === 'zero_ui'
  return <div className="situation-details">
    <div className="situation-heading">
      <div><small>Escenario de simulación</small><h2>{snapshot.scenario_name}</h2></div>
      <span role="status">{snapshot.pending_live ? `Contexto pendiente · ${voiceStatus}` : voiceStatus}</span>
    </div>
    {snapshot.narrative && <blockquote className="scenario-narrative"><small>Narrativa de simulación</small><p>{snapshot.narrative}</p></blockquote>}
    {zero && <div className="zero-orb-wrap"><span className={`zero-orb ${playing ? 'speaking' : ''}`} aria-hidden="true"/>
      <div className="button-group"><button className="button" onClick={openVoice}>Controles de voz</button>
      <button className="button" onClick={useWorkspace}>Alternar vista de misión</button></div></div>}
    <dl className="situation-metrics">
      {zero && <div><dt>O₂ de cabina</dt><dd>{habitat.oxygen_percent} %</dd></div>}
      {(zero || snapshot.heart_rate_bpm !== null) && <div><dt>Frecuencia cardiaca</dt><dd>{snapshot.heart_rate_bpm ?? heartRate ?? '—'} bpm</dd></div>}
      {zero && <div><dt>Tiempo de reserva ficticio</dt><dd>{habitat.reserve_minutes_demo} min</dd></div>}
      {snapshot.stress_proxy !== null && <div><dt>Estrés · proxy sintético</dt><dd>{snapshot.stress_proxy}/100</dd></div>}
      {snapshot.mission_day !== null && <div><dt>Día narrativo</dt><dd>{snapshot.mission_day}</dd></div>}
      {snapshot.communication_delay_minutes !== null && <div><dt>Retraso ficticio Tierra–Marte</dt><dd>{snapshot.communication_delay_minutes} min</dd></div>}
    </dl>
    {snapshot.emotional_fatigue_demo && <p className="muted">La situación narrativa incluye fatiga emocional simulada.</p>}
    {habitat.dust_storm && <p className="muted">Tormenta de polvo exterior simulada.</p>}
    {snapshot.actions.length > 0 && <details><summary>Acciones de hábitat registradas ({snapshot.actions.length})</summary>
      <ul>{snapshot.actions.map((item, index) => <li key={index}>{item.replaceAll('_',' ')}</li>)}</ul></details>}
    {snapshot.breathing_guide && <div className="scenario-guide">
      {!hidden && <BreathingTrack epoch={epoch} pausedAt={guide ? null : pausedAt}/>}
      <div className="button-group">
        {!hidden && <button className="button" onClick={toggleGuide}>{guide ? 'Pausar guía' : 'Reanudar guía'}</button>}
        <button className="button" onClick={() => setHidden(!hidden)}>{hidden ? 'Mostrar guía' : 'Ocultar guía'}</button>
      </div>
    </div>}
    <div className="button-group">
      <button className="button" aria-pressed={ambient} onClick={() => setAmbient(!ambient)}>{ambient ? 'Silenciar ambiente' : 'Activar ambiente'}</button>
      <label>Volumen <input aria-label="Volumen ambiental" type="range" min={0} max={1} step={.05} value={volume}
        onChange={e => setVolume(Number(e.target.value))}/></label>
    </div>
    {ambientError && <p role="status">{ambientError}</p>}
    {snapshot.active_mode === 'ground_anchor' && <AcousticProxy key={graph ? 'active' : 'idle'} graph={graph}/>}
  </div>
}

