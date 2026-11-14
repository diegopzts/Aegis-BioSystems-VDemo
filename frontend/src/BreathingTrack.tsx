import { useEffect, useRef, useState } from 'react'
import { BREATH_SECONDS } from './ambience'

export function breathFrame(elapsed: number) {
  const cycle = BREATH_SECONDS * 1000
  const phase = ((elapsed % cycle) + cycle) % cycle
  const inhale = phase < cycle / 2
  const progress = inhale ? phase / (cycle / 2) : (cycle - phase) / (cycle / 2)
  return {inhale, progress: (1 - Math.cos(progress * Math.PI)) / 2}
}

export function BreathingTrack({epoch, pausedAt}: {epoch: number; pausedAt: number | null}) {
  const track = useRef<HTMLDivElement>(null)
  const [inhale, setInhale] = useState(true)
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const change = () => setReduced(media.matches)
    media.addEventListener?.('change', change)
    return () => media.removeEventListener?.('change', change)
  }, [])
  useEffect(() => {
    if (reduced) return
    let frame = 0
    function update() {
      const next = breathFrame(pausedAt ?? Date.now() - epoch)
      setInhale(next.inhale)
      track.current?.style.setProperty('--breath-position', String(next.progress))
      if (pausedAt === null) frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [epoch, pausedAt, reduced])
  return <div className="breathing-track" ref={track}>
    <strong>{reduced ? 'INHALA 5 s · EXHALA 5 s' : pausedAt !== null ? 'Guía en pausa' : inhale ? 'INHALA' : 'EXHALA'}</strong>
    <div className="breathing-line" aria-hidden="true"><span/></div>
    <p>Sigue el ritmo solo si te resulta cómodo</p>
  </div>
}

