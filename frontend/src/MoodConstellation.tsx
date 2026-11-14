import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import { Stars } from 'lucide-react'
import { SectionTitle } from './components'
import type { MoodEntry } from './contracts'
import { moods } from './moodScale'

type StarEntry = MoodEntry & {id: number}
const ticks = [1, 2, 3, 4, 5, null]
const x = (stress: number | null) => stress === null ? 502 : 66 + (stress - 1) * 92
const y = (energy: number | null) => energy === null ? 221 : 178 - (energy - 1) * 36
const EXIT_MS = 220
const formatDate = (entry: StarEntry) => new Date(entry.recordedAt).toLocaleString('es')
const score = (value: number | null) => value == null ? 'Sin dato' : `${value}/5`

function EntryDetails({entry}: {entry: StarEntry}) {
  return <>
    <strong>ID {entry.id} · {moods[entry.mood - 1].label}</strong>
    <p>{formatDate(entry)} · Estrés {score(entry.stress)} · Energía {score(entry.energy)}</p>
    {entry.notes && <p className="constellation-note">{entry.notes}</p>}
  </>
}

export function MoodConstellation({history}: {history: MoodEntry[]}) {
  const tooltipId = useId()
  const entries = useMemo(() => history.filter((entry): entry is StarEntry =>
    entry.source === 'checkin' && typeof entry.id === 'number').sort((a, b) =>
      Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id - b.id), [history])
  const [lastEntries, setLastEntries] = useState(entries)
  const [hovered, setHovered] = useState<number>()
  const [focused, setFocused] = useState<number>()
  const [selected, setSelected] = useState<number>()
  const currentIds = new Set(entries.map(entry => entry.id))
  const activeTooltip = entries.find(entry => entry.id === (hovered ?? focused))
  const selectedEntry = entries.find(entry => entry.id === selected)
  const groups = new Map<string, number>()
  const stars = [...entries, ...lastEntries.filter(entry => !currentIds.has(entry.id))]
  useEffect(() => {
    // Keep only confirmed removals on screen briefly for the exit transition.
    const removed = lastEntries.some(entry => !entries.some(item => item.id === entry.id))
    if (!removed || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (lastEntries !== entries) setLastEntries(entries)
      return
    }
    const timer = window.setTimeout(() => setLastEntries(entries), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [entries, lastEntries])

  return <section className="panel content-panel" aria-label="Constelación Emocional">
    <SectionTitle icon={<Stars size={19}/>} title="Constelación Emocional"
      subtitle="Autorregistros de bienestar · Escala de 1 a 5"/>
    {!entries.length && <p className="muted">Aún no hay autorregistros para mostrar.</p>}
    {!!stars.length && <>
      <ul className="mood-legend" aria-label="Colores de ánimo">{moods.map(mood =>
        <li key={mood.label}><i style={{background: mood.color}}/>{mood.label}</li>)}</ul>
      <svg className="constellation-plot" viewBox="0 0 570 280" aria-label="Estrés en el eje horizontal y energía en el eje vertical">
        <g aria-hidden="true" className="constellation-grid">
          {ticks.map(tick => <g key={tick ?? 'missing'}>
            <line x1={x(tick)} y1={27} x2={x(tick)} y2={232}/><line x1={58} y1={y(tick)} x2={528} y2={y(tick)}/>
            <text x={x(tick)} y={250} textAnchor="middle">{tick ?? 'Sin dato'}</text>
            <text x={53} y={y(tick) + 4} textAnchor="end">{tick ?? 'Sin dato'}</text>
          </g>)}
          <text x={58} y={16}>Energía</text><text x={294} y={272} textAnchor="middle">Estrés</text>
          <polyline className="constellation-line" points={entries.map(entry => `${x(entry.stress)},${y(entry.energy)}`).join(' ')}/>
        </g>
        {stars.map(entry => {
          const position = `${x(entry.stress)},${y(entry.energy)}`
          const stack = groups.get(position) ?? 0
          groups.set(position, stack + 1)
          const leaving = !currentIds.has(entry.id)
          const mood = moods[entry.mood - 1]
          return <g key={entry.id} className="constellation-star" data-leaving={leaving} data-position={position}
            style={{transform: `translate(${x(entry.stress)}px, ${y(entry.energy)}px)`, color: mood.color,
              '--star-glow': `${2 + entry.mood}px`} as CSSProperties}
            role={leaving ? undefined : 'button'} tabIndex={leaving ? undefined : 0} aria-hidden={leaving || undefined}
            aria-pressed={leaving ? undefined : selected === entry.id}
            aria-label={`ID ${entry.id}, ${mood.label}, estrés ${score(entry.stress)}, energía ${score(entry.energy)}`}
            aria-describedby={activeTooltip?.id === entry.id ? tooltipId : undefined}
            onFocus={() => setFocused(entry.id)} onBlur={() => setFocused(undefined)}
            onMouseEnter={() => setHovered(entry.id)} onMouseLeave={() => setHovered(undefined)}
            onClick={() => setSelected(entry.id)}
            onKeyDown={e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); setSelected(entry.id)}}}>
            <circle r={Math.min(16, 6 + stack * 2)} className="constellation-halo"/>
            <path d="M0 -6 L2 -2 L6 0 L2 2 L0 6 L-2 2 L-6 0 L-2 -2 Z"/>
            <line x1={5} y1={-3} x2={10 + (stack % 4) * 12} y2={-9 - (stack % 3) * 8}/>
            <text x={12 + (stack % 4) * 12} y={-8 - (stack % 3) * 8}>ID {entry.id}</text>
          </g>
        })}
      </svg>
    </>}
    {activeTooltip && <div className="constellation-detail" role="tooltip" id={tooltipId}><EntryDetails entry={activeTooltip}/></div>}
    {selectedEntry && <div className="constellation-detail" role="region" aria-label="Detalle del autorregistro">
      <EntryDetails entry={selectedEntry}/>
    </div>}
    {!!entries.length && <details className="constellation-list"><summary>Lista accesible de autorregistros</summary>
      <ol>{entries.map(entry => <li key={entry.id}><EntryDetails entry={entry}/>
        <button type="button" className="text-button" onClick={() => setSelected(entry.id)}>Ver detalle de ID {entry.id}</button></li>)}</ol>
    </details>}
  </section>
}

