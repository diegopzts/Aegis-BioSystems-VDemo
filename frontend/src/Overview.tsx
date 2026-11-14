import { Activity, ArrowRight, CircleAlert, Clock3, HeartHandshake, Moon, Orbit, Radio, Route } from 'lucide-react'
import { DataChart, MetricCard, Observations, SectionTitle } from './components'
import { metrics, type Metric, type Mission, type Section } from './contracts'

export function Overview({mission, navigate, openMetric, openNight}: {
  mission: Mission; navigate: (section: Section) => void; openMetric: (metric: Metric) => void; openNight: (day: number) => void
}) {
  const sleep = mission.sleep
  const points = mission.metrics.sleepHours.history.map((value, index, history) =>
    ({label: `D${mission.day - history.length + index + 1}`, value})).slice(-7)
  return <>
    <section className="mission-hero panel" aria-label="Mission summary">
      <div className="hero-content">
        <div className="eyebrow"><span className="live-dot"/>{mission.destination} expedition · {mission.phase}</div>
        <h2>{mission.mission}</h2>
        <p>Autonomous Health Intelligence for Space Exploration</p>
        <div className="hero-facts">
          <span><Orbit size={16}/> Mission day <strong>{String(mission.day).padStart(2, '0')} / {mission.plannedDays}</strong></span>
          <span><Route size={16}/> Destination <strong>{mission.destination}</strong></span>
          <span><Radio size={16}/> Crew <strong>{mission.crewId}</strong></span>
        </div>
      </div>
    </section>
    <section className="dashboard-section">
      <SectionTitle icon={<Activity size={19}/>} title="Crew Health Snapshot" subtitle="Latest daily measurements" action={
        <button className="text-button" onClick={() => navigate('vitals')}>Explore vitals <ArrowRight size={15}/></button>}/>
      <div className="metrics-grid">{metrics.map(metric => <MetricCard key={metric} metric={metric} data={mission.metrics[metric]} reviewed={mission.reviewedAlerts?.includes(`vital-${metric}`)} onClick={() => openMetric(metric)}/>)}</div>
    </section>
    <div className="overview-grid">
      <section className="panel content-panel">
        <SectionTitle icon={<Moon size={18}/>} title="Sleep Trend" subtitle={`Last ${points.length} mission days`} action={
          <button className="text-button" onClick={() => navigate('sleep')}>View calendar <ArrowRight size={14}/></button>}/>
        <div className="chart-summary"><strong>{sleep.weeklyAverage.toFixed(1)} <small>h</small></strong><span>weekly average</span>
          <span className="baseline"><i/> {sleep.baseline} h baseline</span></div>
        <DataChart points={points} lines={[{key: 'value', name: 'Sleep', color: '#58d7ff'}]} baseline={sleep.baseline} unit="h" height={190} mode="area" domain={[0, 10]}/>
      </section>
      <section className="panel content-panel">
        <SectionTitle icon={<CircleAlert size={18}/>} title="Preventive Observations" subtitle="Triggered by simulation rules"/>
        <Observations items={sleep.recommendations} reviewed={mission.reviewedAlerts} onOpen={openNight}/>
      </section>
    </div>
    <section className="panel wellness-preview">
      <SectionTitle icon={<HeartHandshake size={18}/>} title="Crew Wellbeing" subtitle={mission.wellness.source === 'checkin' ? 'Latest crew check-in' : 'Simulated daily check-in'}/>
      <div><span>Mood</span><strong>{mission.wellness.mood}/5</strong></div>
      <div><span>Stress</span><strong>{mission.wellness.stress === null ? '—' : `${mission.wellness.stress}/5`}</strong></div>
      <div><span>Energy</span><strong>{mission.wellness.energy === null ? '—' : `${mission.wellness.energy}/5`}</strong></div>
      <button className="text-button" onClick={() => navigate('wellness')}><Clock3 size={15}/> Check in <ArrowRight size={14}/></button>
    </section>
  </>
}
