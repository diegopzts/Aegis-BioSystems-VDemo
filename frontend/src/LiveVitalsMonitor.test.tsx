// @vitest-environment jsdom
import {act, fireEvent, render} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {LiveVitalsMonitor} from './LiveVitalsMonitor'

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks()})

it('draws the original live wave, publishes the displayed values, and stops on pause or unmount', async () => {
  const jobs = new Map<number, FrameRequestCallback>()
  let handle = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {jobs.set(++handle, cb); return handle})
  vi.stubGlobal('cancelAnimationFrame', (id: number) => jobs.delete(id))
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}})
  const strokes = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: strokes,
  } as never)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(220)
  const server = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, {status: 204}))
  vi.stubGlobal('fetch', server)
  const step = (time: number) => act(async () => {
    const active = [...jobs.values()]
    jobs.clear()
    active.forEach(fn => fn(time))
  })
  const {container, unmount} = render(<LiveVitalsMonitor/>)
  const root = container.firstElementChild!.shadowRoot!
  const click = (id: string) => fireEvent.click(root.getElementById(id)!)
  const last = () => JSON.parse(String(server.mock.lastCall![1].body))
  await step(1000)
  expect(root.getElementById('val-bpm')!.textContent).toBe('77')
  expect(last()).toMatchObject({mode: 'simulation', sample: {ecgBpm: 77, spo2: 98, sto2: 84, rso2: 68}})
  expect(strokes).toHaveBeenCalled()
  click('ecg-btn-stemi')
  await step(1140)
  expect(root.getElementById('val-bpm')!.textContent).toBe('98')
  expect(last()).toMatchObject({mode: 'simulation', sample: {profile: 'stemi', ecgBpm: 98}})
  click('monitor-pause')
  await step(1050)
  expect(last()).toMatchObject({mode: 'paused', sample: null})
  const count = strokes.mock.calls.length
  await step(1080)
  expect(strokes.mock.calls.length).toBe(count)
  click('monitor-reset')
  await step(1100)
  expect(last()).toMatchObject({epoch: 1, mode: 'simulation', sample: {ecgBpm: 77}})
  unmount()
  expect(jobs.size).toBe(0)
  expect(last()).toMatchObject({mode: 'closed', sample: null})
})
