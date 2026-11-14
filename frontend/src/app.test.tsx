// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { SleepCalendar } from './SleepPage'
import { actionList, type Mission, type Sleep, type SleepDay } from './contracts'
import { useVoice } from './voice'
import { checkinDue } from './checkinPrompt'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('@react-three/fiber', () => ({Canvas: () => <span>WebGL canvas</span>}))
vi.mock('@react-three/drei', () => ({Grid: () => null, OrbitControls: () => null}))
vi.mock('recharts', async importOriginal => {
  const original = await importOriginal<typeof import('recharts')>()
  return {...original, ResponsiveContainer: () => null}
})

const night: SleepDay = {
  day: 30, date: '2026-11-14', hours: 6.2, durationMinutes: 372, bedtime: '23:00', wakeTime: '05:12',
  awakenings: 2, quality: 3, scheduleOffset: 60, status: 'irregular', regular: false,
}
const sleep: Sleep = {
  days: [{...night, day: 29, date: '2026-11-13', status: 'attention', hours: 5.9, durationMinutes: 354}, night],
  analysis: {weeklyAverage: 6.4, monthlyAverage: 7.5, baseline: 7.8, baselineDelta: -1.4, streak: 5,
    longestStreak: 5, irregularDays: [30], shortDays: [29,30], attentionDays: [29], trend: 'falling',
    weeklyChange: -0.8, recommendations: [], rules: {shortMinutes: 420, attentionMinutes: 360, irregularOffset: 60, persistentNights: 3}},
}
const metricValue = (value: number, unit: string) => ({value, unit, baseline: value, delta: 0, state: 'stable' as const, history: [value]})
const mission: Mission = {
  scenario: 'short_sleep', name: 'Maya Chen', mission: 'Ares Pathfinder', role: 'Mission Specialist', crewId: 'AST-01',
  day: 30, date: night.date, destination: 'Mars', phase: 'Outbound transit', plannedDays: 210,
  sleep: sleep.analysis, wellness: {day: 30, date: night.date, recordedAt: night.date, mood: 3, stress: 2, energy: 4, notes: '', source: 'simulated'},
  metrics: {heartRate: metricValue(70, 'bpm'), temperature: metricValue(36.6, '°C'), spo2: metricValue(98, '%'), sleepHours: metricValue(6.2, 'h')},
}

beforeEach(() => { localStorage.clear(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function mockApi(geminiStatus: 'configured' | 'unconfigured' = 'configured', chatReply?: unknown) {
  const fetch = vi.fn(async (input: string) => {
    const value = input.startsWith('/api/mission') ? mission : input.startsWith('/api/sleep') ? sleep :
      input === '/api/health' ? {status: 'ok', geminiStatus} :
      input === '/api/companion/activity' ? [] :
      chatReply ?? {reply: 'Opening the chest view.', model: 'provider-double', actions: [{type: 'viewer', region: 'chest', view: 'right'}]}
    return new Response(JSON.stringify(value), {status: 200})
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('mission console', () => {
  it('renders accessible calendar states and selects a night', () => {
    const select = vi.fn()
    render(<SleepCalendar days={sleep.days} day={29} select={select}/>)
    expect(screen.getByRole('list', {name: 'Sleep status legend'}).textContent).toContain('No data')
    expect(screen.getByRole('button', {name: /mission day 29/}).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', {name: /mission day 30/}))
    expect(select).toHaveBeenCalledWith(30)
  })

  it('navigates to sleep, displays details, and changes simulation through the API', async () => {
    const fetch = mockApi()
    render(<App/>)
    expect(await screen.findByRole('heading', {name: 'Ares Pathfinder'})).toBeTruthy()
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', {name: 'Sleep Intelligence'}))
    expect(await screen.findByRole('heading', {name: 'Sleep Calendar'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {name: /mission day 29/}))
    expect(screen.getAllByText('Mission day 29')).toHaveLength(1)
    fireEvent.change(screen.getByRole('combobox', {name: 'Simulation scenario'}), {target: {value: 'recovery'}})
    expect(fetch).toHaveBeenCalledWith('/api/sleep?scenario=recovery&day=30', expect.anything())
  })

  it('keeps the mission available with Gemini unconfigured', async () => {
    const fetch = mockApi('unconfigured')
    render(<App/>)
    expect(await screen.findByRole('heading', {name: 'Ares Pathfinder'})).toBeTruthy()
    await screen.findByText('System online')
    fireEvent.click(screen.getByRole('button', {name: 'AEGIS AI Companion'}))
    expect(screen.getByText(/Gemini sin configurar/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', {name: 'Mensaje para AEGIS'}), {target: {value: 'Test'}})
    expect((screen.getByRole('button', {name: 'Enviar mensaje'}) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', {name: 'Iniciar voz'}) as HTMLButtonElement).disabled).toBe(true)
    expect(fetch.mock.calls.some(([path]) => path === '/api/chat')).toBe(false)
  })

  it('executes a validated assistant action and resets the viewer', async () => {
    mockApi()
    render(<App/>)
    await screen.findByText('System online')
    fireEvent.click(screen.getByRole('button', {name: 'AEGIS AI Companion'}))
    fireEvent.change(screen.getByRole('textbox', {name: 'Mensaje para AEGIS'}), {target: {value: 'Open chest'}})
    fireEvent.click(screen.getByRole('button', {name: 'Enviar mensaje'}))
    expect(await screen.findByText('WebGL canvas')).toBeTruthy()
    expect(screen.getByRole('button', {name: 'Chest'}).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', {name: 'right'}).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', {name: 'Reset view'}))
    expect(screen.getByRole('button', {name: 'Full body'}).getAttribute('aria-pressed')).toBe('true')
  })

  it('refreshes the mission from the committed change returned by chat', async () => {
    const fetch = mockApi('configured', {reply: 'Cambio aplicado.', model: 'mock', actions: [], changes: [
      {operation: 'advance_mission', record: {scenario: 'short_sleep', day: 8}, refresh: 'mission'},
    ]})
    render(<App/>)
    await screen.findByText('System online')
    fireEvent.click(screen.getByRole('button', {name: 'AEGIS AI Companion'}))
    fireEvent.change(screen.getByRole('textbox', {name: 'Mensaje para AEGIS'}), {target: {value: 'Avanza un día'}})
    fireEvent.click(screen.getByRole('button', {name: 'Enviar mensaje'}))
    await screen.findByText(/Guardado · Avanzar un día/)
    expect(screen.queryByRole('button', {name: 'Confirmar'})).toBeNull()
    await waitFor(() => expect(fetch.mock.calls.some(([path]) => path === '/api/mission?scenario=short_sleep&day=8')).toBe(true))
  })

  it('schedules a check-in only at the configured time and once each eligible mission day', () => {
    const settings = {enabled: true, paused: false, metrics: false, every: 2 as const, time: '09:00', shown: [1]}
    const morning = new Date(2026, 10, 14, 8, 59)
    const scheduled = new Date(2026, 10, 14, 9, 0)
    expect(checkinDue(settings, 3, morning)).toBe(false)
    expect(checkinDue(settings, 3, scheduled)).toBe(true)
    expect(checkinDue(settings, 1, scheduled)).toBe(false)
    expect(checkinDue(settings, 2, scheduled)).toBe(false)
    expect(checkinDue({...settings, paused: true}, 3, scheduled)).toBe(false)
    expect(checkinDue({...settings, enabled: false}, 3, scheduled)).toBe(false)
  })

  it('strictly accepts only supported actions', () => {
    expect(actionList.safeParse([{type: 'navigate', section: 'sleep'}]).success).toBe(true)
    for (const action of [{type: 'exec'}, {type: 'chart', metric: 'heartRate', range: '1m'},
      {type: 'viewer', region: 'head', view: 'front', extra: 1}]) {
      expect(actionList.safeParse([action]).success).toBe(false)
    }
  })
})

it('releases microphone, AudioContext and socket on Stop', async () => {
  const stop = vi.fn()
  const closeContext = vi.fn().mockResolvedValue(undefined)
  const closeSocket = vi.fn()
  const disconnect = vi.fn()
  const connect = vi.fn()
  const closePort = vi.fn()
  class MockContext {
    state = 'running'
    currentTime = 0
    close = closeContext
    resume = vi.fn().mockResolvedValue(undefined)
    audioWorklet = {addModule: vi.fn().mockResolvedValue(undefined)}
    createMediaStreamSource() { return {connect, disconnect} }
  }
  class MockWorklet {
    port = {close: closePort, onmessage: null}
    disconnect = disconnect
  }
  let socket: MockSocket
  class MockSocket {
    onmessage?: (event: {data: string}) => void
    close = closeSocket
    constructor() { socket = this }
  }
  const getUserMedia = vi.fn().mockResolvedValue({getTracks: () => [{stop}]})
  vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}})
  vi.stubGlobal('AudioContext', MockContext)
  vi.stubGlobal('AudioWorkletNode', MockWorklet)
  vi.stubGlobal('WebSocket', MockSocket)
  const {result} = renderHook(() => useVoice('short_sleep', vi.fn()))
  await act(async () => { await result.current.start() })
  expect(result.current.state).toBe('connecting')
  act(() => socket.onmessage?.({data: JSON.stringify({type: 'state', value: 'listening'})}))
  await waitFor(() => expect(result.current.state).toBe('listening'))
  expect(connect).toHaveBeenCalled()
  act(() => result.current.stop())
  expect(result.current.state).toBe('disconnected')
  for (const fn of [stop, closeContext, closeSocket, closePort]) expect(fn).toHaveBeenCalledOnce()
  expect(disconnect).toHaveBeenCalledTimes(2)
})

it('keeps a single greeting in the chat when it is reopened', async () => {
  mockApi('unconfigured')
  render(<App/>)
  const open = screen.getByRole('button', {name: 'AEGIS AI Companion'})
  fireEvent.click(open)
  const conversation = screen.getByRole('log', {name: 'Conversación'})
  expect(within(conversation).getAllByText('¿Cómo estás, cómo te sientes hoy?')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', {name: 'Cerrar asistente'}))
  fireEvent.click(open)
  expect(within(conversation).getAllByText('¿Cómo estás, cómo te sientes hoy?')).toHaveLength(1)
  await screen.findByText(/Gemini sin configurar/)
})

it('refreshes a constellation star after a confirmed Companion edit and retains it when refresh fails', async () => {
  const first = {...mission.wellness, id: 12, source: 'checkin', stress: 2, notes: 'Personal'}
  let history = [first]
  let failRefresh = false
  let operations = 0
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    let payload: unknown = {}
    if (path.startsWith('/api/mission')) payload = mission
    if (path === '/api/health') payload = {status: 'ok', geminiStatus: 'configured'}
    if (path === '/api/companion/activity') payload = []
    if (path.startsWith('/api/wellness?')) {
      if (failRefresh) return new Response('{}', {status: 503})
      payload = {history, trend: [], pairedDays: 0, stressSleepCorrelation: null}
    }
    if (path === '/api/chat') {
      operations++
      history = operations === 1 ? [{...first, stress: 5}] : operations === 3 ? [] : [{...first, stress: 4}]
      failRefresh = operations === 2
      payload = {reply: 'Operación confirmada', model: 'mock', actions: [], changes: [{
        operation: operations === 3 ? 'delete_wellness_entry' : 'update_wellness_entry', record: {id: 12}, refresh: 'wellness',
      }]}
    }
    return new Response(JSON.stringify(payload), {status: 200})
  }))
  render(<App/>)
  fireEvent.click(screen.getByRole('button', {name: 'Psychological Wellness'}))
  const star = await screen.findByRole('button', {name: /ID 12.*estrés 2\/5/})
  fireEvent.click(screen.getByRole('button', {name: 'AEGIS AI Companion'}))
  const send = (message: string) => {
    fireEvent.change(screen.getByRole('textbox', {name: 'Mensaje para AEGIS'}), {target: {value: message}})
    fireEvent.click(screen.getByRole('button', {name: 'Enviar mensaje'}))
  }
  await screen.findByText(/Gemini configurado/)
  send('Edita el registro 12')
  expect(await screen.findByRole('button', {name: /ID 12.*estrés 5\/5/})).toBe(star)
  send('Edita la energía del registro 12')
  await screen.findByText('Connection interrupted')
  expect(screen.getByRole('button', {name: /ID 12.*estrés 5\/5/})).toBe(star)
  send('Borra el registro 12')
  await waitFor(() => expect(screen.queryByRole('button', {name: /^ID 12,/})).toBeNull())
})
