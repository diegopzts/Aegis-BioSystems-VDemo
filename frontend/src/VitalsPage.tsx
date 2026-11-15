import { Activity, ChartNoAxesColumn, ChartNoAxesCombined, Download } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useResource } from './api'
import { DataChart, ResourceStatus, SectionTitle, metricIcons } from './components'
import { metricColors, metricLabels, metrics, spans, type Metric, type Scenario, type Span, type VitalSeries } from './contracts'

const spanLabels: Record<Span, string> = {'24h': '24 hours', '7d': '7 days', '30d': '30 days'}
const LiveVitalsMonitor = lazy(() => import('./LiveVitalsMonitor').then(module => ({default: module.LiveVitalsMonitor})))

function download(series: VitalSeries, format: 'csv' | 'json') {
  const payload = format === 'json' ? JSON.stringify(series, null, 2) :
    ['timestamp,mission_day,value,unit,baseline,scenario', ...series.points.map(point =>
      [point.label, point.day ?? '', point.value, series.unit, series.baseline, series.scenario].join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob([payload], {type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json'}))
  const link = document.createElement('a')
  link.href = url
  link.download = `aegis-${series.scenario}-${series.metric}-${series.range}.${format}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function VitalsPage({scenario, day, revision, metric, span, setMetric, setSpan}: {
  scenario: Scenario; day: number; revision: number; metric: Metric; span: Span; setMetric: (metric: Metric) => void; setSpan: (span: Span) => void
}) {
  const [mode, setMode] = useState<'line' | 'bar'>('line')
  const {data, error, retry} = useResource<VitalSeries>(`vitals?scenario=${scenario}&metric=${metric}&range=${span}&day=${day}`, revision, true)
  return <>
    <Suspense fallback={<p role="status">Loading live monitor…</p>}><LiveVitalsMonitor/></Suspense>
    <details className="panel content-panel" open={metric !== 'heartRate' || span !== '7d'}>
    <summary>Simulated mission history</summary>
    <div className="control-strip">{metrics.map(key => {
      const Icon = metricIcons[key]
      return <button key={key} className="button" aria-pressed={metric === key} onClick={() => setMetric(key)}><Icon size={16}/>{metricLabels[key]}</button>
    })}</div>
    {data ? <section className="panel content-panel">
      <SectionTitle icon={<Activity size={19}/>} title={metricLabels[metric]} subtitle={span === '24h' ? `Hourly measurements · mission day ${day}` : 'Daily measurements'}
        action={<div className="button-group">
          <button className="button" onClick={() => download(data, 'csv')}><Download size={15}/> CSV</button>
          <button className="button" onClick={() => download(data, 'json')}><Download size={15}/> JSON</button>
        </div>}/>
      <div className="chart-controls"><div className="button-group">
        {spans.map(key => <button key={key} className="button" aria-pressed={key === span} onClick={() => setSpan(key)}>{spanLabels[key]}</button>)}
      </div><div className="button-group">
        <button className="icon-button" aria-label="Line chart" aria-pressed={mode === 'line'} onClick={() => setMode('line')}><ChartNoAxesCombined size={18}/></button>
        <button className="icon-button" aria-label="Bar chart" aria-pressed={mode === 'bar'} onClick={() => setMode('bar')}><ChartNoAxesColumn size={18}/></button>
      </div></div>
      <DataChart points={data.points} lines={[{key: 'value', name: metricLabels[metric], color: metricColors[metric]}]}
        mode={mode} baseline={data.baseline} unit={data.unit} height={360} domain={metric === 'sleepHours' ? [0, span === '24h' ? 1.1 : 10] : undefined}/>
      <p className="baseline"><i/> Individual baseline {Number(data.baseline.toFixed(2))} {data.unit}{metric === 'sleepHours' && span === '24h' ? ' per hour' : ''}</p>
    </section> : <ResourceStatus error={error} retry={retry}/>}
    </details>
  </>
}
