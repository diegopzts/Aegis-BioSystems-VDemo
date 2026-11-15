import { z } from 'zod'

export const sections = ['overview', 'vitals', 'sleep', 'wellness', 'body', 'crew', 'relax'] as const
const crewIds = ['AST-01', 'AST-02', 'AST-03', 'AST-04', 'AST-05', 'AST-06'] as const
export type CrewId = typeof crewIds[number]
export const relaxCommands = ['start_breathing', 'play_ambient', 'pause_ambient', 'stop_ambient', 'open_memory', 'open_zen'] as const
export type RelaxCommand = typeof relaxCommands[number]
export const orbitModules = ['overview', 'vitals', 'sleep', 'wellness', 'body', 'companion', 'crew', 'relax'] as const
export const metrics = ['heartRate', 'temperature', 'spo2', 'sleepHours'] as const
export const spans = ['24h', '7d', '30d'] as const
export const regions = ['full', 'head', 'chest', 'limbs'] as const
export const views = ['front', 'left', 'right', 'back'] as const
export const scenarios = {
  short_sleep: 'Sleep deficit', nominal: 'Nominal operations', schedule_shift: 'Schedule disruption',
  stress: 'Elevated stress', recovery: 'Progressive recovery',
} as const

export type Scenario = keyof typeof scenarios
export type Section = typeof sections[number]
export type Metric = typeof metrics[number]
export type Span = typeof spans[number]
export type Region = typeof regions[number]
export type View = typeof views[number]
export type SleepStatus = 'favorable' | 'irregular' | 'attention'
export type SleepDay = {
  day: number; date: string; hours: number; durationMinutes: number; bedtime: string; wakeTime: string;
  awakenings: number; quality: number; scheduleOffset: number; status: SleepStatus; regular: boolean
}
export type Recommendation = {title: string; reason: string; action: string; days: number[]; level: SleepStatus}
export type SleepAnalysis = {
  weeklyAverage: number; monthlyAverage: number; baseline: number; baselineDelta: number;
  rules: {shortMinutes: number; attentionMinutes: number; irregularOffset: number; persistentNights: number}
  streak: number; longestStreak: number; irregularDays: number[]; shortDays: number[];
  attentionDays: number[]; trend: string; weeklyChange: number; recommendations: Recommendation[]
}
export type Sleep = {days: SleepDay[]; analysis: SleepAnalysis; reviewedAlerts?: string[]}
export type Checkin = {mood: number; stress: number | null; energy: number | null; notes: string}
export type MoodEntry = Checkin & {id?: number | null;day: number; date: string; recordedAt: string; source: 'simulated' | 'checkin'}
export type Wellness = {
  history: MoodEntry[]; current: MoodEntry; trend: (Omit<Checkin, 'notes'> & {day: number; date: string; sleepHours: number})[];
  stressSleepCorrelation: number | null; pairedDays: number
}
export type Mission = {
  scenario: Scenario; name: string; mission: string; role: string; crewId: string; day: number; date: string; reviewedAlerts?: string[];
  destination: string; phase: string; plannedDays: number; sleep: SleepAnalysis; wellness: MoodEntry;
  metrics: Record<Metric, {value: number; unit: string; baseline: number; delta: number; state: 'stable' | 'watch'; history: number[]}>
}
export type VitalSeries = {
  scenario: Scenario; metric: Metric; range: Span; unit: string; baseline: number;
  points: {label: string; day?: number; value: number}[]
}
export type Message = {role: 'user' | 'assistant'; text: string}

const action = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('navigate'), section: z.enum(sections)}),
  z.strictObject({type: z.literal('chart'), range: z.enum(spans), metric: z.enum(metrics)}),
  z.strictObject({type: z.literal('viewer'), region: z.enum(regions), view: z.enum(views)}),
  z.strictObject({type: z.literal('relax'), command: z.enum(relaxCommands)}),
  z.strictObject({type: z.literal('crew'), crewId: z.enum(crewIds)}),
  z.strictObject({type: z.literal('orbit')}),
])
export const actionList = z.array(action).max(8)
export type Action = z.infer<typeof action>
export const positionSchema = z.object({scenario: z.enum(['short_sleep', 'nominal', 'schedule_shift', 'stress', 'recovery']), day: z.number().int().min(1).max(30)})
export type Position = z.infer<typeof positionSchema>
export type WorkspaceView = {section: Section; metric: Metric; range: Span; region: Region; view: View; crewId?: CrewId}
export const changeSchema = z.object({
  operation: z.string(), record: z.record(z.string(), z.unknown()), refresh: z.enum(['mission', 'wellness', 'alerts']),
})
export type Change = z.infer<typeof changeSchema>
export const replySchema = z.strictObject({
  reply: z.string().trim().min(1), model: z.string(), actions: actionList,
  changes: z.array(changeSchema).max(1).default([]), sources: z.array(z.string()).max(20).default([]),
})

export const metricLabels: Record<Metric, string> = {
  heartRate: 'Heart rate', temperature: 'Body temperature', spo2: 'Oxygen saturation', sleepHours: 'Sleep duration',
}
export const metricColors: Record<Metric, string> = {
  heartRate: '#58cafa', temperature: '#ad9aff', spo2: '#54d7af', sleepHours: '#f3b76b',
}
export const sleepLabels: Record<SleepStatus | 'missing', string> = {
  favorable: 'Favorable', irregular: 'Irregular', attention: 'Needs attention', missing: 'No data',
}
export const sectionLabels: Record<Section, string> = {
  overview: 'Mission Overview', vitals: 'Vital Monitoring', sleep: 'Sleep Intelligence',
  wellness: 'Psychological Wellness', body: 'BioSystems 3D',
  crew: 'Crew Management', relax: 'Relax Room',
}
export const regionLabels: Record<Region, string> = {full: 'Full body', head: 'Head', chest: 'Chest', limbs: 'Limbs'}

export function dateLabel(date: string) {
  return new Intl.DateTimeFormat('en', {month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(date))
}
export function signed(value: number, digits = 1) {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}
