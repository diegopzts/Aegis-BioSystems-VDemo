import type { ReactNode } from 'react'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CircleAlert, Droplets, HeartPulse, Moon, Thermometer, TrendingUp } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { dateLabel, metricColors, metricLabels, signed, type Metric, type Mission, type Recommendation } from './contracts'

export const metricIcons = {heartRate: HeartPulse, temperature: Thermometer, spo2: Droplets, sleepHours: Moon}

export function ResourceStatus({error, retry}: {error?: string; retry: () => void}) {
  return <div className="panel resource-status" role={error ? 'alert' : 'status'}>
    {error ? <CircleAlert size={22}/> : <Activity className="pulse" size={22}/>}
    <div><strong>{error ? 'Connection interrupted' : 'Loading mission data'}</strong>
      {error && <p>{error} Check that FastAPI is running on port 8005.</p>}</div>
    {error && <button className="button" onClick={retry}>Retry</button>}
  </div>
}

export function SectionTitle({icon, title, subtitle, action}: {icon: ReactNode; title: string; subtitle?: string; action?: ReactNode}) {
  return <header className="section-title"><div className="section-icon">{icon}</div>
    <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="section-action">{action}</div>}
  </header>
}

export function MetricCard({metric, data, reviewed, onClick}: {metric: Metric; data: Mission['metrics'][Metric]; reviewed?: boolean; onClick: () => void}) {
  const Icon = metricIcons[metric]
  const Trend = data.delta < 0 ? ArrowDownRight : ArrowUpRight
  const color = metricColors[metric]
  return <button className="panel metric-card" onClick={onClick} style={{'--metric': color} as React.CSSProperties}>
    <span className="metric-top"><span className="metric-icon"><Icon size={17}/></span>
      <span className={`status ${data.state === 'watch' ? 'irregular' : 'favorable'}`}><i/>{reviewed ? 'Revisada' : data.state === 'watch' ? 'Watch' : 'Stable'}</span></span>
    <span className="metric-name">{metricLabels[metric]}</span>
    <span className="metric-value">{data.value.toLocaleString('en', {maximumFractionDigits: 1})} <small>{data.unit}</small></span>
    <span className="metric-trend"><Trend size={13}/>{signed(data.delta)} vs prior 7d</span>
    <span className="sparkline" aria-hidden="true">
      <ResponsiveContainer width="100%" height={46}>
        <LineChart data={data.history.map(value => ({value}))} margin={{left: 2, right: 2, top: 6, bottom: 6}}>
          <YAxis hide domain={['auto', 'auto']}/>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false}/>
        </LineChart>
      </ResponsiveContainer>
    </span>
  </button>
}

type Datum = {label: string; value: number; [key: string]: string | number | null}
type Series = {key: string; name: string; color: string}
export function DataChart({points, lines, mode = 'line', baseline, unit, domain, height = 255}: {
  points: Datum[]; lines: Series[]; mode?: 'line' | 'bar' | 'area'; baseline?: number; unit?: string;
  domain?: [number | 'auto', number | 'auto']; height?: number
}) {
  const format = (value: string) => value.includes('-') ? dateLabel(value) : value
  const tick = {fill: '#8ba4be', fontSize: 11}
  const grid = <>
    <CartesianGrid vertical={false} stroke="#213a53" strokeDasharray="3 5"/>
    <XAxis dataKey="label" tickFormatter={format} tick={tick} axisLine={false} tickLine={false} minTickGap={18} tickMargin={12}/>
    <YAxis domain={domain ?? ['auto', 'auto']} tick={tick} axisLine={false} tickLine={false} width={35} tickMargin={5}/>
    <Tooltip labelFormatter={label => format(String(label))} cursor={{stroke: '#526c89', fill: '#16334a'}}
      formatter={(value) => `${Number(value).toLocaleString('en', {maximumFractionDigits: 2})}${unit ? ` ${unit}` : ''}`}
      contentStyle={{background: '#11253a', border: '1px solid #294561', borderRadius: 10, fontSize: 12}}/>
    {baseline !== undefined && <ReferenceLine y={baseline} ifOverflow="extendDomain" stroke="#889cbb" strokeDasharray="5 4"/>}
  </>
  const margin = {top: 12, left: 4, right: 14, bottom: 8}
  return <div className="chart" style={{height}} role="img" aria-label={`Chart of ${lines.map(line => line.name).join(', ')} across ${points.length} observations`}>
    <ResponsiveContainer width="100%" height="100%">
      {mode === 'bar' ? <BarChart data={points} margin={margin}>{grid}
        {lines.map(line => <Bar key={line.key} dataKey={line.key} name={line.name} fill={line.color} radius={[4,4,0,0]} maxBarSize={28} isAnimationActive={false}/>)}
      </BarChart> : mode === 'area' ? <AreaChart data={points} margin={margin}>{grid}
        {lines.map(line => <Area key={line.key} type="monotone" dataKey={line.key} name={line.name} stroke={line.color} fill={line.color} fillOpacity={0.11} strokeWidth={2.3} isAnimationActive={false}/>)}
      </AreaChart> : <LineChart data={points} margin={margin}>{grid}
        {lines.map(line => <Line key={line.key} type="monotone" dataKey={line.key} name={line.name} stroke={line.color} strokeWidth={2.3} dot={false} activeDot={{r: 4}} isAnimationActive={false}/>)}
      </LineChart>}
    </ResponsiveContainer>
  </div>
}

export function Observations({items, onOpen, reviewed = []}: {items: Recommendation[]; onOpen?: (day: number) => void; reviewed?: string[]}) {
  return <div className="observations">{items.map((item, index) => <article key={item.title} className={`observation ${item.level}`}>
    <div className="observation-icon">{item.level === 'favorable' ? <TrendingUp size={17}/> : <CircleAlert size={17}/>}</div>
    <div><h3>{item.title}</h3>{reviewed.includes(`sleep-${index + 1}`) && <span className="status favorable">Revisada</span>}<p>{item.reason}</p><p className="observation-action">{item.action}</p>
      {onOpen && <button className="text-button" onClick={() => onOpen(item.days.at(-1)!)}>Review sleep <ArrowRight size={13}/></button>}
    </div>
  </article>)}</div>
}
