import { useEffect, useState } from 'react'
import { useAmbience } from './ambience'
import { BreathingTrack } from './BreathingTrack'
import { situationIds, type InputGraph, type Simulation, type SituationId } from './simulation'

const labels: Record<SituationId, string> = {
  panic_bio_sync: 'Panic Episode', o2_leak_zero_ui: 'O₂ Leak', extreme_isolation: 'Extreme Isolation',
  mars_murphy: 'Mars Murphy’s Law', nominal: '↺ Restore Nominal',
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
    <strong>Estimated voice activity · acoustic signal only</strong>
    <p>This browser estimates local voice activity.</p>
    {graph ? <svg role="img" aria-label="RMS energy of the local signal" viewBox="0 0 200 36" preserveAspectRatio="none">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={series.map((value, index) =>
        `${index * 5},${34 - Math.min(1, value * 5) * 32}`).join(' ')}/></svg> :
      <p>Available after starting voice and allowing microphone access.</p>}
  </div>
}

export function ScenarioBar({snapshot, busy, error, activate, heartRate, playing, voiceStatus, graph, openVoice, useWorkspace, onBreathing}: {
  snapshot?: Simulation; busy?: SituationId; error: string; activate: (id: SituationId) => void;
  heartRate?: number; playing: boolean; voiceStatus: string; graph?: InputGraph; openVoice: () => void; useWorkspace: () => void; onBreathing?: (eventId?: string) => void
}) {
  return <section className="panel scenario-bar" aria-label="Simulate a Situation">
    <strong>Simulate a Situation:</strong>
    <div className="button-group">{situationIds.map(id =>
      <button type="button" className="button" key={id} disabled={Boolean(busy)}
        aria-pressed={snapshot?.scenario_id === id} onClick={() => activate(id)}>{labels[id]}</button>)}</div>
    <p className="muted">Educational simulation with synthetic data</p>
    <p role="status">{busy ? 'Activating situation…' : snapshot?.scenario_id === 'nominal' ? 'Nominal situation active' : !snapshot ? 'Loading situation…' : ''}</p>
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
      <div><small>Simulation scenario</small><h2>{snapshot.scenario_name}</h2></div>
      <span role="status">{snapshot.pending_live ? `Context pending · ${voiceStatus}` : voiceStatus}</span>
    </div>
    {snapshot.narrative && <blockquote className="scenario-narrative"><small>Simulation narrative</small><p>{snapshot.narrative}</p></blockquote>}
    {zero && <div className="zero-orb-wrap"><span className={`zero-orb ${playing ? 'speaking' : ''}`} aria-hidden="true"/>
      <div className="button-group"><button className="button" onClick={openVoice}>Voice controls</button>
      <button className="button" onClick={useWorkspace}>Toggle mission workspace</button></div></div>}
    <dl className="situation-metrics">
      {zero && <div><dt>Cabin O₂</dt><dd>{habitat.oxygen_percent} %</dd></div>}
      {(zero || snapshot.heart_rate_bpm !== null) && <div><dt>Heart rate</dt><dd>{snapshot.heart_rate_bpm ?? heartRate ?? '—'} bpm</dd></div>}
      {zero && <div><dt>Simulated reserve time</dt><dd>{habitat.reserve_minutes_demo} min</dd></div>}
      {snapshot.stress_proxy !== null && <div><dt>Stress · synthetic estimate</dt><dd>{snapshot.stress_proxy}/100</dd></div>}
      {snapshot.mission_day !== null && <div><dt>Scenario day</dt><dd>{snapshot.mission_day}</dd></div>}
      {snapshot.communication_delay_minutes !== null && <div><dt>Simulated Earth–Mars delay</dt><dd>{snapshot.communication_delay_minutes} min</dd></div>}
    </dl>
    {snapshot.emotional_fatigue_demo && <p className="muted">This scenario includes simulated emotional fatigue.</p>}
    {habitat.dust_storm && <p className="muted">Simulated dust storm outside the habitat.</p>}
    {snapshot.actions.length > 0 && <details><summary>Recorded habitat actions ({snapshot.actions.length})</summary>
      <ul>{snapshot.actions.map((item, index) => <li key={index}>{item.replaceAll('_',' ')}</li>)}</ul></details>}
    {snapshot.breathing_guide && <div className="scenario-guide">
      {!hidden && <BreathingTrack epoch={epoch} pausedAt={guide ? null : pausedAt}/>}
      <div className="button-group">
        {!hidden && <button className="button" onClick={toggleGuide}>{guide ? 'Pause guide' : 'Resume guide'}</button>}
        <button className="button" onClick={() => setHidden(!hidden)}>{hidden ? 'Show guide' : 'Hide guide'}</button>
      </div>
    </div>}
    <div className="button-group">
      <button className="button" aria-pressed={ambient} onClick={() => setAmbient(!ambient)}>{ambient ? 'Mute ambience' : 'Enable ambience'}</button>
      <label>Volume <input aria-label="Ambient volume" type="range" min={0} max={1} step={.05} value={volume}
        onChange={e => setVolume(Number(e.target.value))}/></label>
    </div>
    {ambientError && <p role="status">{ambientError}</p>}
    {snapshot.active_mode === 'ground_anchor' && <AcousticProxy key={graph ? 'active' : 'idle'} graph={graph}/>}
  </div>
}

