import { useEffect, useRef, useState } from 'react'
import { acquireAudio } from './audioContext'

export const BREATH_SECONDS = 10

export function createAmbience(context: AudioContext, breathe: boolean, phaseSeconds: number, texture = 'soft_wind') {
  const frames = 2 * context.sampleRate
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const samples = buffer.getChannelData(0)
  let softened = 0
  for (let i = 0; i < samples.length; i++) {
    softened = softened * .94 + (Math.random() * 2 - 1) * .06
    samples[i] = softened * Math.min(1, i / 256, (samples.length - i - 1) / 256)
  }
  const noise = context.createBufferSource()
  noise.buffer = buffer
  noise.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = texture === 'warm_rain' ? 920 : texture === 'dust_wind' ? 460 : 630
  const pulse = context.createGain()
  pulse.gain.value = .7
  const volume = context.createGain()
  volume.gain.value = 0
  noise.connect(filter).connect(pulse).connect(volume).connect(context.destination)
  const lfo = breathe ? context.createOscillator() : undefined
  const depth = breathe ? context.createGain() : undefined
  if (lfo && depth) {
    const angle = phaseSeconds / BREATH_SECONDS * 2 * Math.PI
    lfo.frequency.value = 1 / BREATH_SECONDS
    lfo.setPeriodicWave(context.createPeriodicWave(
      new Float32Array([0, -Math.cos(angle)]), new Float32Array([0, Math.sin(angle)]),
    ))
    depth.gain.value = .22
    lfo.connect(depth).connect(pulse.gain)
    lfo.start()
  }
  noise.start()
  return {
    volume(level: number, duck: boolean) {
      volume.gain.setTargetAtTime(level * (duck ? .18 : 1) * .22, context.currentTime, duck ? .05 : .2)
    },
    stop() {
      noise.stop()
      lfo?.stop()
      for (const node of [noise, filter, pulse, volume, lfo, depth]) node?.disconnect()
    },
  }
}

export function useAmbience(eventId: string, enabled: boolean, breathe: boolean, epoch: number, level: number, playing: boolean, texture: string) {
  const graph = useRef<ReturnType<typeof createAmbience> | undefined>(undefined)
  const [error, setError] = useState('')
  const latest = useRef({level, playing})
  latest.current = {level, playing}
  useEffect(() => {
    if (!enabled) { setError(''); return }
    let cancelled = false
    let dispose: (() => void) | undefined
    async function connect() {
      const lease = await acquireAudio()
      try {
        if (cancelled) { await lease.release(); return }
        await lease.context.resume()
        if (cancelled) { await lease.release(); return }
        if (lease.context.state !== 'running') throw new Error()
        const value = createAmbience(lease.context, breathe, ((Date.now() - epoch) / 1000) % BREATH_SECONDS, texture)
        graph.current = value
        value.volume(latest.current.level, latest.current.playing)
        setError('')
        dispose = () => { value.stop(); graph.current = undefined; void lease.release() }
      } catch {
        await lease.release()
        if (!cancelled) setError('El navegador pausó el ambiente. Actívalo de nuevo.')
      }
    }
    void connect().catch(() => { if (!cancelled) setError('No se pudo iniciar el ambiente.') })
    return () => { cancelled = true; dispose?.() }
  }, [eventId, enabled, breathe, epoch, texture])
  useEffect(() => { graph.current?.volume(level, playing) }, [level, playing])
  return error
}

