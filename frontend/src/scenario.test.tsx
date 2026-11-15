// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {App} from './App'
import {BreathingTrack, breathFrame} from './BreathingTrack'
import {ScenarioBar} from './ScenarioBar'
import {createAmbience} from './ambience'
import type {Simulation} from './simulation'

afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()})

const base: Simulation = {
  scenario_id: 'nominal', scenario_name: 'Nominal', active_mode: 'standard', started_at: '2026-11-14T00:00:00Z',
  event_id: 'n', version: 1, mission_day: null, heart_rate_bpm: null, stress_proxy: null,
  communication_delay_minutes: null, emotional_fatigue_demo: false, pending_live: false, breathing_guide: false,
  orbital: {distance_million_km: 377.74, one_way_seconds: 1260, one_way_label: '21 min 00 s',
    link_status: 'normal', link_label: 'Link nominal', autonomous_override: false, synthetic: true},
  actions: [], ambience: 'silent', habitat: {oxygen_percent: 20.9, co2_ppm: 600, pressure_kpa: 101.3, reserve_minutes_demo: 40,
    sealed_sectors: [], oxygen_reserve: 'off', lighting_percent: 65, dust_storm: false},
}

it('applies the confirmed snapshot, preserves Zero-UI exit and voice controls, and keeps it on a failed change', async () => {
  let resolve!: (value: Response) => void
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status})
  vi.stubGlobal('fetch', vi.fn((path: string) => {
    if (path === '/api/simulation/o2_leak_zero_ui') return new Promise<Response>(callback => {resolve = callback})
    if (path === '/api/simulation/mars_murphy') return Promise.resolve(response({}, 503))
    if (path === '/api/simulation/nominal/reset') return Promise.resolve(response({...base, event_id: 'reset', version: 3}))
    return Promise.resolve(response(path === '/api/simulation' ? base : {}, path === '/api/simulation' ? 200 : 503))
  }))
  const {container} = render(<App/>)
  const mode = () => container.querySelector('.app-shell')?.getAttribute('data-aegis-mode')
  await waitFor(() => expect(screen.getByRole('button', {name: '↺ Restore Nominal'}).getAttribute('aria-pressed')).toBe('true'))
  const orbital = within(screen.getByRole('region', {name: 'Monitor Earth–Mars'}))
  expect(orbital.getByText('Link nominal')).toBeTruthy()
  expect(orbital.getByText(/21 min 00 s one way/)).toBeTruthy()
  const leak = screen.getByRole('button', {name: 'O₂ Leak'}) as HTMLButtonElement
  fireEvent.click(leak)
  expect(leak.disabled).toBe(true)
  expect(mode()).toBe('standard')
  resolve(response({...base, scenario_id: 'o2_leak_zero_ui', scenario_name: 'Fuga', active_mode: 'zero_ui',
    event_id: 'l', version: 2, heart_rate_bpm: 68,
    orbital: {...base.orbital, link_status: 'warning', link_label: 'NO REAL-TIME RESPONSE', autonomous_override: true}, habitat: {...base.habitat, oxygen_percent: 16.4}}))
  await screen.findByText('16.4 %')
  expect(orbital.getByText('NO REAL-TIME RESPONSE')).toBeTruthy()
  expect(orbital.getByText(/AEGIS AUTONOMOUS OVERRIDE/)).toBeTruthy()
  expect(mode()).toBe('zero_ui')
  expect(screen.getByRole('button', {name: 'Voice controls'})).toBeTruthy()
  expect(screen.getByText('Simulated reserve time')).toBeTruthy()
  expect(container.querySelector('.mission-widgets')?.hasAttribute('hidden')).toBe(true)
  fireEvent.click(screen.getByRole('button', {name: 'Mars Murphy’s Law'}))
  await screen.findByText(/The change could not be confirmed/)
  expect(mode()).toBe('zero_ui')
  fireEvent.click(screen.getByRole('button', {name: '↺ Restore Nominal'}))
  await waitFor(() => expect(mode()).toBe('standard'))
  expect(orbital.queryByText(/AEGIS AUTONOMOUS OVERRIDE/)).toBeNull()
  expect(orbital.getByText('Link nominal')).toBeTruthy()
})

it('runs a local analyser on the existing mic graph and disconnects it on exit', () => {
  const analyser = {fftSize: 0, getFloatTimeDomainData: vi.fn(), disconnect: vi.fn()}
  const graph = {context: {createAnalyser: () => analyser}, input: {connect: vi.fn(), disconnect: vi.fn()}}
  const mic = vi.fn()
  vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: mic}})
  const cancel = vi.spyOn(window, 'cancelAnimationFrame')
  const props = {error: '', activate: vi.fn(), playing: false, voiceStatus: 'Listening', openVoice: vi.fn(), useWorkspace: vi.fn()}
  const {rerender} = render(<ScenarioBar {...props}
    snapshot={{...base, scenario_id: 'extreme_isolation', active_mode: 'ground_anchor'}}
    graph={graph as unknown as NonNullable<Parameters<typeof ScenarioBar>[0]['graph']>}/>)
  expect(screen.getByText('Estimated voice activity · acoustic signal only')).toBeTruthy()
  expect(graph.input.connect).toHaveBeenCalledWith(analyser)
  expect(mic).not.toHaveBeenCalled()
  rerender(<ScenarioBar {...props} snapshot={base}/>)
  expect(cancel).toHaveBeenCalled()
  expect(graph.input.disconnect).toHaveBeenCalledWith(analyser)
})

it('sets a ten-second LFO, ducks the ambience gain, and stops both sources', () => {
  function node() {
    return {gain: {value: 0, setTargetAtTime: vi.fn()}, frequency: {value: 0},
      connect: vi.fn((target: unknown) => target), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), setPeriodicWave: vi.fn()}
  }
  const [noise, filter, pulse, volume, lfo, depth] = Array.from({length: 6}, node)
  const gains = [pulse, volume, depth]
  const context = {sampleRate: 8000, currentTime: 20, destination: {}, createBuffer: () => ({getChannelData: () => new Float32Array(16000)}),
    createBufferSource: () => noise, createBiquadFilter: () => filter,
    createGain: () => gains.shift(), createOscillator: () => lfo, createPeriodicWave: vi.fn()}
  const ambience = createAmbience(context as unknown as AudioContext, true, 0)
  expect(lfo.frequency.value).toBe(.1)
  ambience.volume(.3, false)
  ambience.volume(.3, true)
  ambience.volume(0, false)
  expect(volume.gain.setTargetAtTime.mock.calls[1][0]).toBeLessThan(volume.gain.setTargetAtTime.mock.calls[0][0])
  expect(volume.gain.setTargetAtTime.mock.calls[2][0]).toBe(0)
  ambience.stop()
  expect(noise.stop).toHaveBeenCalledOnce()
  expect(lfo.stop).toHaveBeenCalledOnce()
})


it('uses two equal halves of one ten-second cycle', () => {
  expect(breathFrame(0)).toEqual({inhale: true, progress: 0})
  expect(breathFrame(4999).inhale).toBe(true)
  expect(breathFrame(5000)).toEqual({inhale: false, progress: 1})
  expect(breathFrame(9999).inhale).toBe(false)
  expect(breathFrame(10000)).toEqual(breathFrame(0))
})

it('keeps the Bio-Sync guide pausable and dismissible and removes it on nominal', () => {
  const props = {error: '', activate: vi.fn(), playing: false, voiceStatus: 'Listening', openVoice: vi.fn(), useWorkspace: vi.fn()}
  const panic: Simulation = {...base, breathing_guide: true, active_mode: 'breathing_sync', scenario_id: 'panic_bio_sync',
    narrative: 'Anomaly detected. Breathe at a comfortable pace.'}
  const {rerender} = render(<ScenarioBar {...props} snapshot={panic}/>)
  expect(screen.getByText('Follow the rhythm at a comfortable pace')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', {name: 'Pause guide'}))
  expect(screen.getByText('Guide paused')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', {name: 'Resume guide'}))
  fireEvent.click(screen.getByRole('button', {name: 'Hide guide'}))
  expect(screen.queryByText('Follow the rhythm at a comfortable pace')).toBeNull()
  fireEvent.click(screen.getByRole('button', {name: 'Show guide'}))
  expect(screen.getByText(/Anomaly detected/)).toBeTruthy()
  rerender(<ScenarioBar {...props} snapshot={base}/>)
  expect(screen.queryByText(/Anomaly detected/)).toBeNull()
  expect(screen.queryByRole('button', {name: 'Pause guide'})).toBeNull()
})

it('sends a mood selection to FastAPI before showing success', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    const payload = path.includes('/checkin') ? JSON.parse(String(init?.body)) : null
    if (payload) expect(payload).toEqual({mood: 4, notes: '', energy: null, stress: null})
    return new Response('{}', {status: payload ? 201 : 503})
  })
  vi.stubGlobal('fetch', fetch)
  render(<App/>)
  fireEvent.click(screen.getByRole('button', {name: 'Psychological Wellness'}))
  const save = screen.getByRole('button', {name: 'Save mood'}) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  fireEvent.click(screen.getByRole('radio', {name: /^Good$/}))
  fireEvent.click(save)
  await screen.findByText('Check-in saved.')
  expect(fetch.mock.calls.some(([path]) => path.includes('/api/wellness/checkin'))).toBe(true)
})

it('renders the Bio-Sync phase boundaries using a fake clock and cancels its frame on unmount', () => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => window.setTimeout(() => fn(performance.now()), 10))
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout.bind(window))
  const {unmount, container} = render(<BreathingTrack epoch={Date.now()} pausedAt={null}/>)
  const track = container.querySelector<HTMLElement>('.breathing-track')!
  expect(screen.getByText('BREATHE IN')).toBeTruthy()
  act(() => vi.advanceTimersByTime(4990))
  expect(screen.getByText('BREATHE IN')).toBeTruthy()
  act(() => vi.advanceTimersByTime(10))
  expect(screen.getByText('BREATHE OUT')).toBeTruthy()
  expect(track.style.getPropertyValue('--breath-position')).toBe('1')
  act(() => vi.advanceTimersByTime(4990))
  expect(screen.getByText('BREATHE OUT')).toBeTruthy()
  act(() => vi.advanceTimersByTime(10))
  expect(screen.getByText('BREATHE IN')).toBeTruthy()
  expect(track.style.getPropertyValue('--breath-position')).toBe('0')
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('renders a static Bio-Sync guide with reduced motion and schedules no frames', () => {
  vi.useFakeTimers()
  const removeEventListener = vi.fn()
  vi.stubGlobal('matchMedia', () => ({matches: true, addEventListener: vi.fn(), removeEventListener}))
  const {unmount} = render(<BreathingTrack epoch={Date.now()} pausedAt={null}/>)
  expect(screen.getByText('BREATHE IN 5 s · BREATHE OUT 5 s')).toBeTruthy()
  expect(vi.getTimerCount()).toBe(0)
  unmount()
  expect(removeEventListener).toHaveBeenCalledOnce()
})
