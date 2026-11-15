import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Brain, HeartHandshake, NotebookPen, Wind } from 'lucide-react'
import { post, useResource } from './api'
import { MoodConstellation } from './MoodConstellation'
import { moods } from './moodScale'
import { DataChart, ResourceStatus, SectionTitle } from './components'
import { dateLabel, type Checkin, type MoodEntry, type Scenario, type Wellness } from './contracts'

const initial: Omit<Checkin, 'mood'> & {mood: number | null} = {mood: null, stress: null, energy: null, notes: ''}


function Breathing() {
  const [elapsed, setElapsed] = useState<number | null>(null)
  const active = elapsed !== null && elapsed < 60
  useEffect(() => {
    if (!active) return
    const start = performance.now()
    const timer = setInterval(() => setElapsed(Math.min(60, Math.floor((performance.now() - start) / 1000))), 250)
    return () => clearInterval(timer)
  }, [active])
  const phase = active ? (elapsed % 10 < 4 ? 'Breathe in gently' : 'Breathe out slowly') : elapsed === 60 ? 'Pause complete' : 'Ready when you are'
  return <section className="panel content-panel">
    <SectionTitle icon={<Wind size={19}/>} title="Guided Breathing" subtitle="A one-minute pause between mission tasks"/>
    <div className={`breath-block ${active ? 'active' : ''}`}>
      <div className="breath-ring"><Wind size={27}/></div>
      <strong aria-live="polite">{phase}</strong>
      <span>{active ? `${60 - elapsed}s remaining` : 'Use a comfortable pace.'}</span>
      <button className="button" onClick={() => setElapsed(active ? null : 0)}>{active ? 'Stop pause' : 'Start pause'}</button>
    </div>
  </section>
}

export function WellnessPage({scenario, day, revision, onSave}: {scenario: Scenario; day: number; revision: number; onSave: () => void}) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const [saveError, setSaveError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const {data, error, retry} = useResource<Wellness>(`wellness?scenario=${scenario}&day=${day}`, revision, true)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || form.mood === null) return
    submitting.current = true
    setSaving(true)
    setSaveStatus('')
    setSaveError('')
    try {
      await post<MoodEntry>(`wellness/checkin?scenario=${scenario}&day=${day}`, form)
      setForm(initial)
      setSaveStatus('Check-in saved.')
      onSave()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the check-in.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  return <>
    <div className="split-grid wellness-grid">
      <section className="panel content-panel">
        <SectionTitle icon={<NotebookPen size={19}/>} title="How are you feeling today?" subtitle="Choose a mood and add an optional note."/>
        <form onSubmit={submit} className="checkin">
          <fieldset disabled={saving}><legend>Mood</legend>
            <div className="mood-bubbles">{moods.map(({label, icon: Icon, color}, index) => {
              const value = index + 1
              return <label key={label} style={{color}}>
                <input type="radio" name="mood" value={value} checked={form.mood === value}
                  onChange={() => setForm({...form, mood: value})}/>
                <span className="mood-bubble"><Icon size={25} aria-hidden="true"/></span><span>{label}</span>
              </label>
            })}</div>
          </fieldset>
          <details className="mood-extras"><summary>Energy, stress, and notes (optional)</summary>
            <div className="mood-options">{(['energy', 'stress'] as const).map(key =>
              <label key={key}>{key === 'energy' ? 'Energy' : 'Stress'}
                <select value={form[key] ?? ''} disabled={saving}
                  onChange={event => setForm({...form, [key]: event.target.value ? Number(event.target.value) : null})}>
                  <option value="">Not recorded</option>{[1,2,3,4,5].map(value => <option key={value}>{value}</option>)}
                </select>
              </label>)}</div>
            <label htmlFor="reflection">Personal note</label>
            <textarea id="reflection" maxLength={600} value={form.notes} disabled={saving}
              onChange={event => setForm({...form, notes: event.target.value})}/>
          </details>
          <p className="muted">Use fictional data. A service restart can clear demo records.</p>
          <button className="button primary" disabled={saving || form.mood === null}>{saving ? 'Saving…' : 'Save mood'}</button>
          <p role="status">{saveStatus}</p>
          {saveError && <p role="alert" className="inline-warning">{saveError}</p>}
        </form>
      </section>
      <div className="stack">
        <Breathing/>
        <section className="panel content-panel">
          <SectionTitle icon={<HeartHandshake size={19}/>} title="Crew Support"/>
          <ul className="support-list">
            <li>Set aside time for a short personal reflection.</li>
            <li>Plan a regular check-in with a crewmate to stay connected.</li>
            <li>Use breaks between tasks to rest and reset.</li>
          </ul>
          <p className="muted">Ask crew medical support or mission control for help if distress persists or feels urgent.</p>
        </section>
      </div>
    </div>
    {data && <MoodConstellation history={data.history}/>}
    {data && error && <ResourceStatus error={error} retry={retry}/>}
    {data ? <div className="split-grid">
      <section className="panel content-panel">
        <SectionTitle icon={<Brain size={19}/>} title="Wellbeing Trends" subtitle={`Latest ${data.pairedDays} paired mission days`}/>
        <DataChart points={data.trend.slice(-14).map(row => ({label: row.date, value: row.mood, stress: row.stress, energy: row.energy}))}
          lines={[{key: 'value', name: 'Mood', color: '#58d7ff'}, {key: 'stress', name: 'Stress', color: '#f3b76b'}, {key: 'energy', name: 'Energy', color: '#54d7af'}]} domain={[1, 5]}/>
        <div className="trend-legend"><span>Mood</span><span>Stress</span><span>Energy</span></div>
        <p className="muted">Sleep and stress correlation across {data.pairedDays} paired days is {data.stressSleepCorrelation === null ? 'unavailable with too few ratings or no variation' : `r = ${data.stressSleepCorrelation.toFixed(2)}`}. This describes association only.</p>
      </section>
      <section className="panel content-panel">
        <SectionTitle icon={<NotebookPen size={19}/>} title="Check-in History" subtitle="Most recent records first"/>
        {!data.history.some(row => row.source === 'checkin') && <p className="muted">No personal check-ins yet.</p>}
        <ol className="history-list">{data.history.slice(0, 10).map((row, index) => <li key={`${row.recordedAt}-${index}`}>
          <div><strong>{row.source === 'checkin' ? new Date(row.recordedAt).toLocaleString('en-US') : dateLabel(row.date)}</strong><span>{row.source === 'checkin' ? `Manual #${row.id}` : 'Simulation'}</span></div>
          <p>Mood {row.mood}/5{row.stress != null && ` · Stress ${row.stress}/5`}{row.energy != null && ` · Energy ${row.energy}/5`}</p>
          {row.notes && <p>{row.notes}</p>}
        </li>)}</ol>
      </section>
    </div> : <ResourceStatus error={error} retry={retry}/>}
  </>
}
