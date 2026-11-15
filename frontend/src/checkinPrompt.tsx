import { useEffect, useState } from 'react'
import { HeartHandshake } from 'lucide-react'
import { z } from 'zod'
import { positionSchema, type Mission, type Position } from './contracts'

const settingsSchema = z.object({
  enabled: z.boolean(), paused: z.boolean(), metrics: z.boolean(),
  every: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(7)]),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  shown: z.array(z.number().int().min(1).max(30)).max(30),
})
type Settings = z.infer<typeof settingsSchema>
const defaults: Settings = {enabled: true, paused: false, metrics: true, every: 1, time: '00:00', shown: []}
const key = 'aegis-checkin-v2'

function localValue(name: string) {
  try { return JSON.parse(localStorage.getItem(name) ?? 'null') } catch { return null }
}

export function saveLocal(name: string, value: unknown) {
  try { localStorage.setItem(name, JSON.stringify(value)) } catch { /* Browser storage may be disabled. */ }
}
export function loadPosition(): Position {
  const value = positionSchema.safeParse(localValue('aegis-mission-v1'))
  return value.success ? value.data : {scenario: 'short_sleep', day: 30}
}
export function checkinDue(settings: Settings, day: number, now: Date) {
  const [hour, minute] = settings.time.split(':').map(Number)
  return settings.enabled && !settings.paused && !settings.shown.includes(day) &&
    (day - 1) % settings.every === 0 && now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute
}

export function useCheckinPrompt(day: number, ready: boolean) {
  const [settings, setSettings] = useState<Settings>(() => {
    const value = settingsSchema.safeParse(localValue(key))
    return value.success ? value.data : defaults
  })
  const [visible, setVisible] = useState<number>()
  function update(patch: Partial<Settings>) {
    setSettings(previous => {
      const next = {...previous, ...patch}
      saveLocal(key, next)
      return next
    })
  }
  useEffect(() => {
    if (!ready || !settings.enabled || settings.paused) return
    function check() {
      if (!checkinDue(settings, day, new Date())) return
      const saved = settingsSchema.safeParse(localValue(key))
      if (saved.success && saved.data.shown.includes(day)) return
      update({shown: [...settings.shown, day]})
      setVisible(day)
    }
    check()
    const timer = window.setInterval(check, 15_000)
    return () => window.clearInterval(timer)
  }, [day, ready, settings])
  return {settings, update, visible: ready && settings.enabled && !settings.paused && visible === day,
          dismiss: () => setVisible(undefined)}
}
export type CheckinPromptState = ReturnType<typeof useCheckinPrompt>

export function CheckinSettings({prompt}: {prompt: CheckinPromptState}) {
  const {settings, update} = prompt
  return <div className="companion-settings">
    <label><input type="checkbox" checked={settings.enabled} onChange={e => update({enabled: e.target.checked})}/> Invite me to check in within AEGIS</label>
    <label><input type="checkbox" checked={settings.paused} onChange={e => update({paused: e.target.checked})}/> Pause check-ins</label>
    <label>Frequency <select value={settings.every} onChange={e => update({every: Number(e.target.value) as Settings['every']})}>
      {[1, 2, 3, 7].map(n => <option key={n} value={n}>{n === 1 ? 'Every simulated day' : `Every ${n} simulated days`}</option>)}
    </select></label>
    <label>Starting at <input type="time" value={settings.time} onChange={e => {if (e.target.value) update({time: e.target.value})}}/> (local time)</label>
    <label><input type="checkbox" checked={settings.metrics} onChange={e => update({metrics: e.target.checked})}/> Mention recent manual ratings in the invitation</label>
  </div>
}

export function CheckinPrompt({mission, metrics, dismiss, open}: {mission: Mission; metrics: boolean; dismiss: () => void; open: () => void}) {
  const recent = mission.wellness
  return <section className="panel checkin-invite" aria-label="Wellbeing invitation">
    <HeartHandshake size={22}/><div><strong>How are you feeling today?</strong>
      <p>{metrics && recent.source === 'checkin' && recent.energy != null
        ? `You recorded an energy rating of ${recent.energy}/5 on day ${recent.day}. How are you feeling now?`
        : 'Take a moment to talk or record how you feel.'}</p>
      <div className="button-group"><button className="button" onClick={open}>Open AEGIS</button>
        <button className="button" onClick={dismiss}>Not now</button>
        <button className="button" onClick={dismiss}>Do not ask again today</button></div>
    </div>
  </section>
}

