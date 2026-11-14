import { useEffect, useState, type CSSProperties } from 'react'
import type { VoiceState } from './voice'
import type { InputGraph } from './simulation'

export function smoothVocalActivity(samples: Float32Array, previous: number) {
  if (!samples.length) return previous
  let sum = 0
  for (const sample of samples) sum += sample * sample
  const rms = Math.sqrt(sum / samples.length)
  const target = Math.min(100, Math.max(0, (rms - .008) * 400))
  return previous + (target - previous) * (target > previous ? .24 : .15)
}

export function VoiceOrb({graph, breathing = false, alert = false, output = 0, state = 'disconnected', label = 'En reposo'}: {
  graph?: InputGraph; breathing?: boolean; alert?: boolean; output?: number; state?: VoiceState; label?: string
}) {
  const [activity, setActivity] = useState<number>()
  useEffect(() => {
    setActivity(undefined)
    if (!graph) return
    const analyser = graph.context.createAnalyser()
    analyser.fftSize = 512
    // Tap the existing graph. This branch has no output connection.
    graph.input.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let smoothed = 0
    const interval = window.setInterval(() => {
      if (graph.context.state !== 'running') {
        smoothed = 0
        setActivity(undefined)
        return
      }
      analyser.getFloatTimeDomainData(samples)
      smoothed = smoothVocalActivity(samples, smoothed)
      setActivity(Math.round(smoothed))
    }, 100)
    return () => {
      window.clearInterval(interval)
      try { graph.input.disconnect(analyser) } catch { /* Voice may already have disconnected its input. */ }
      analyser.disconnect()
    }
  }, [graph])

  const available = Boolean(graph) && activity !== undefined
  const amplitude = state === 'playing' ? output : state === 'listening' ? activity ?? 0 : 0
  const intensity = Math.min(1, (amplitude / 100 + (alert ? .3 : 0)) * (breathing ? .55 : 1))
  return <section className="voice-orb-panel" aria-label="Actividad vocal estimada">
    <svg viewBox="0 0 64 64" className="voice-orb" data-active={state !== 'disconnected'} data-voice-state={state} style={{'--orb-intensity': intensity} as CSSProperties} aria-hidden="true">
      <circle className="voice-orb-halo" cx="32" cy="32" r="29"/>
      <circle className="voice-orb-wave" cx="32" cy="32" r="27"/>
      <circle className="voice-orb-track" cx="32" cy="32" r="24"/>
      <circle className="voice-orb-segments" cx="32" cy="32" r="26"/>
      <circle className="voice-orb-core" cx="32" cy="32" r="14"/>
      <circle className="voice-orb-rim" cx="32" cy="32" r="20"/>
    </svg>
    <div><strong>Actividad vocal estimada</strong><p role="status">{label}</p>
      <p>{available ? `${activity}/100` : 'No disponible'}</p>
      <small>Proxy acústico experimental; no mide emociones, estrés clínico ni salud</small>
    </div>
  </section>
}

