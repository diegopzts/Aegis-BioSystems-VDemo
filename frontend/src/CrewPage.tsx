import {useState} from 'react'
import {useResource} from './api'
import {ResourceStatus} from './components'
import type {CrewId, Scenario} from './contracts'
import './missionExperience.css'

const statuses = {active: 'Active', resting: 'Resting', exercising: 'Exercising', off_duty: 'Off Duty', pending: 'Check-in Pending'} as const
type Status = keyof typeof statuses
type Member = {id: CrewId; name: string; role: string; status: Status; heartRate: number; sleepHours: number;
  wellness: 'routine' | 'check_in_due'; lastCheckInDay: number | null; observation: string; sleepTrend: {day: number; hours: number}[]}

export function CrewPage({scenario, day, revision, selected, select}: {
  scenario: Scenario; day: number; revision: number; selected: CrewId; select: (id: CrewId) => void
}) {
  const {data, error, retry} = useResource<{members: Member[]}>(`crew?scenario=${scenario}&day=${day}`, revision, true)
  const [filter, setFilter] = useState<Status | 'all'>('all')
  if (!data) return <ResourceStatus error={error} retry={retry}/>
  const crew = data.members
  const person = crew.find(member => member.id === selected)
  const count = (status: Status) => crew.filter(member => member.status === status).length
  const stats = [['Total Crew Members', crew.length], ['Active Members', count('active')], ['Resting Members', count('resting')],
    ['Pending Check-ins', count('pending')], ['Crew Wellness Overview', `${crew.filter(member => member.wellness === 'routine').length} routine`]]
  return <div className="crew-page">
    <p className="muted">Synthetic crew data · Mission day {day}</p>
    <dl className="crew-stats">{stats.map(([label, value]) => <div className="panel" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <label className="crew-filter">Operational status <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
      <option value="all">All crew members</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <div className="crew-roster" aria-label="Crew profiles">{crew.filter(member => filter === 'all' || filter === member.status).map(member =>
      <button type="button" key={member.id} className="panel crew-profile" aria-pressed={selected === member.id} onClick={() => select(member.id)}>
        <span className="crew-profile-avatar" aria-hidden="true">{member.name.split(' ').map(word => word[0]).join('')}</span>
        <span><strong>{member.name}</strong><small>{member.id} · {member.role}</small></span>
        <span className="crew-status" data-status={member.status}>{statuses[member.status]}</span>
        <span className="crew-measures">{member.heartRate} bpm · {member.sleepHours} h sleep</span>
      </button>)}</div>
    {person && <section className="panel content-panel crew-detail" aria-labelledby="crew-selected">
      <h2 id="crew-selected">{person.name}</h2>
      <dl className="detail-list">
        <div><dt>Operational status</dt><dd>{statuses[person.status]}</dd></div>
        <div><dt>Wellness check-in status</dt><dd>{person.wellness === 'routine' ? 'Routine' : 'Due'}</dd></div>
        <div><dt>Last check-in</dt><dd>{person.lastCheckInDay ? `Mission day ${person.lastCheckInDay}` : 'No check-in yet'}</dd></div>
      </dl>
      <p>{person.observation}</p>
      <h3>Sleep duration</h3>
      <ul className="crew-trend" aria-label="Sleep trend">{person.sleepTrend.map(point =>
        <li key={point.day}><span>{point.hours} h</span><i style={{height: `${Math.min(100, point.hours * 9)}%`}}/><small>Day {point.day}</small></li>)}</ul>
    </section>}
  </div>
}
