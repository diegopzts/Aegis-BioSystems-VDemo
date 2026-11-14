import { useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, Moon, Sunrise, Waves } from 'lucide-react'
import { DataChart, Observations, ResourceStatus, SectionTitle } from './components'
import { useResource } from './api'
import { dateLabel, signed, sleepLabels, type Scenario, type Sleep, type SleepDay } from './contracts'

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function SleepCalendar({days, day, select}: {days: SleepDay[]; day: number; select: (day: number) => void}) {
  const first = new Date(days[0].date).getUTCDay()
  const offset = (first + 6) % 7
  const blanks = (7 - (days.length + offset) % 7) % 7
  return <>
    <div className="calendar-grid">
      {weekdays.map(label => <div key={label} className="weekday">{label}</div>)}
      {Array.from({length: offset}, (_, i) => <span key={`before-${i}`} className="calendar-day missing" aria-hidden="true"/>)}
      {days.map(night => <button key={night.day} aria-pressed={day === night.day}
        aria-label={`${dateLabel(night.date)}, mission day ${night.day}, ${night.hours} hours, ${sleepLabels[night.status]}`}
        className={`calendar-day ${night.status}`} onClick={() => select(night.day)}>
        <span>{Number(night.date.slice(-2))}<i/></span><small>{night.hours.toFixed(1)} h</small>
      </button>)}
      {Array.from({length: blanks}, (_, i) => <span key={`after-${i}`} className="calendar-day missing" aria-hidden="true"/>)}
    </div>
    <ul className="sleep-legend" aria-label="Sleep status legend">
      {Object.entries(sleepLabels).map(([status, label]) => <li key={status} className={status}><i/>{label}</li>)}
    </ul>
  </>
}

export function SleepPage({scenario, day, revision, selectedDay, select}: {scenario: Scenario; day: number; revision: number; selectedDay?: number; select: (day: number) => void}) {
  const {data, error, retry} = useResource<Sleep>(`sleep?scenario=${scenario}&day=${day}`, revision, true)
  const [weekOffset, setWeekOffset] = useState(0)
  if (!data) return <ResourceStatus error={error} retry={retry}/>
  const {analysis, days} = data
  const night = days.find(day => day.day === selectedDay) ?? days[days.length - 1]
  const yesterday = days.find(day => day.day === night.day - 1)
  const end = days.length - weekOffset * 7
  const week = days.slice(Math.max(0, end - 7), end)
  const minutes = night.durationMinutes % 60
  function reviewDay(day: number) {
    select(day)
    document.querySelector(".night-details")?.scrollIntoView?.({block: "nearest"})
  }
  return <>
    <div className="summary-grid">
      <article className="panel mini-stat"><span>7-day average</span><strong>{analysis.weeklyAverage.toFixed(2)} <small>h</small></strong><p>{signed(analysis.baselineDelta, 2)} h vs baseline</p></article>
      <article className="panel mini-stat"><span>Mission average (up to 30 days)</span><strong>{analysis.monthlyAverage.toFixed(2)} <small>h</small></strong><p>{analysis.baseline} h individual baseline</p></article>
      <article className="panel mini-stat"><span>Current short-night streak</span><strong>{analysis.streak} <small>nights</small></strong><p>Under {analysis.rules.shortMinutes / 60} h · longest streak {analysis.longestStreak}</p></article>
      <article className="panel mini-stat"><span>Weekly trend</span><strong className="capitalize">{analysis.trend}</strong><p>{signed(analysis.weeklyChange, 2)} h vs prior week</p></article>
    </div>
    <div className="split-grid">
      <section className="panel content-panel">
        <SectionTitle icon={<CalendarDays size={19}/>} title="Sleep Calendar" subtitle={`${dateLabel(days[0].date)} – ${dateLabel(days.at(-1)!.date)} · ${days.length} mission days`}/>
        <SleepCalendar days={days} day={night.day} select={select}/>
      </section>
      <section className="panel content-panel night-details" aria-live="polite">
        <SectionTitle icon={<Moon size={19}/>} title={dateLabel(night.date)} subtitle={`Mission day ${night.day}`}/>
        <span className={`status ${night.status}`}><i/>{sleepLabels[night.status]}</span>
        <div className="night-duration">{Math.floor(night.durationMinutes / 60)}<small>h</small> {minutes}<small>m</small></div>
        {yesterday && <p className="muted">{signed((night.durationMinutes - yesterday.durationMinutes) / 60, 2)} h vs previous night</p>}
        <dl className="detail-list">
          <div><dt><Clock3 size={15}/> Bedtime</dt><dd>{night.bedtime}</dd></div>
          <div><dt><Sunrise size={15}/> Wake time</dt><dd>{night.wakeTime}</dd></div>
          <div><dt><Waves size={15}/> Awakenings</dt><dd>{night.awakenings}</dd></div>
          <div><dt>Subjective quality</dt><dd>{night.quality}/5</dd></div>
          <div><dt>Bedtime deviation</dt><dd>{night.scheduleOffset} min</dd></div>
          <div><dt>Schedule</dt><dd>{night.regular ? 'Regular' : 'Shifted'}</dd></div>
        </dl>
      </section>
    </div>
    <div className="split-grid">
      <section className="panel content-panel">
        <SectionTitle icon={<Moon size={18}/>} title="Weekly Sleep Duration" subtitle={`${dateLabel(week[0].date)} – ${dateLabel(week.at(-1)!.date)}`}
          action={<div className="button-group">
            <button className="icon-button" aria-label="Earlier week" disabled={weekOffset >= Math.ceil(days.length / 7) - 1} onClick={() => setWeekOffset(weekOffset + 1)}><ArrowLeft size={16}/></button>
            <button className="icon-button" aria-label="Later week" disabled={weekOffset === 0} onClick={() => setWeekOffset(weekOffset - 1)}><ArrowRight size={16}/></button>
          </div>}/>
        <DataChart points={week.map(day => ({label: day.date, value: day.hours}))}
          lines={[{key: 'value', name: 'Sleep duration', color: '#58d7ff'}]} mode="bar" baseline={analysis.baseline} unit="h" domain={[0, 10]}/>
      </section>
      <section className="panel content-panel">
        <SectionTitle icon={<Waves size={18}/>} title="Patterns & Recovery" subtitle="Demonstration rules based on your calendar"/>
        <Observations items={analysis.recommendations} reviewed={data.reviewedAlerts} onOpen={reviewDay}/>
      </section>
    </div>
  </>
}
