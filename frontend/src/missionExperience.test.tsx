// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {CrewPage} from './CrewPage'
import {RelaxPage} from './RelaxPage'

const ambience = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>(() => ''))
vi.mock('./ambience', () => ({useAmbience: ambience}))
afterEach(() => {cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks()})

it('filters the crew and opens the selected astronaut using synthetic records', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({members: [
    {id: 'AST-01', name: 'Maya Chen', role: 'Specialist', status: 'active', heartRate: 73, sleepHours: 7.8,
      sleepTrend: [{day: 1, hours: 7.8}], wellness: 'routine', lastCheckInDay: 1, observation: 'Flight console.'},
    {id: 'AST-03', name: 'Leo Martínez', role: 'Engineer', status: 'resting', heartRate: 72, sleepHours: 8,
      sleepTrend: [{day: 1, hours: 8}], wellness: 'routine', lastCheckInDay: 1, observation: 'Scheduled rest.'},
  ]})))
  const select = vi.fn()
  render(<CrewPage scenario="nominal" day={1} revision={0} selected="AST-03" select={select}/>)
  await screen.findByRole('heading', {name: 'Leo Martínez'})
  fireEvent.change(screen.getByLabelText('Operational status'), {target: {value: 'resting'}})
  const roster = within(screen.getByLabelText('Crew profiles'))
  expect(roster.getAllByRole('button')).toHaveLength(1)
  fireEvent.click(roster.getByRole('button', {name: /Leo/}))
  expect(select).toHaveBeenCalledWith('AST-03')
  expect(screen.getByLabelText('Sleep trend').textContent).toContain('8 h')
})

it('runs and resets the breathing guide, opens activities and ducks only the ambient player', () => {
  vi.useFakeTimers()
  const setVolume = vi.fn()
  const {rerender} = render(<RelaxPage volume={.4} setVolume={setVolume} duck={false}/>)
  expect(ambience.mock.lastCall?.[1]).toBe(false)
  fireEvent.click(screen.getByRole('button', {name: 'Start'}))
  expect(screen.getByText('Breathe In', {selector: 'p'})).toBeTruthy()
  act(() => vi.advanceTimersByTime(4100))
  expect(screen.getByText('Hold', {selector: 'p'})).toBeTruthy()
  fireEvent.click(screen.getByRole('button', {name: /^Reset$/}))
  expect(screen.getByText('Ready')).toBeTruthy()
  rerender(<RelaxPage volume={.4} setVolume={setVolume} duck={false} intent={{command: 'open_memory', revision: 1}}/>)
  fireEvent.click(screen.getByRole('button', {name: 'Card 1, face down'}))
  fireEvent.click(screen.getByRole('button', {name: 'Card 2, face down'}))
  expect(screen.getByText(/1 moves/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', {name: 'Reset game'}))
  fireEvent.click(screen.getByRole('button', {name: 'Zen Orbit'}))
  const light = screen.getByRole('button', {name: 'Orbital light 1'})
  fireEvent.keyDown(light, {key: 'ArrowRight'})
  expect(light.style.left).toBe('27%')
  fireEvent.click(screen.getByRole('button', {name: 'Reset orbit'}))
  expect(light.style.left).toBe('24%')
  fireEvent.click(screen.getByRole('button', {name: 'Play'}))
  rerender(<RelaxPage volume={.4} setVolume={setVolume} duck/>)
  expect(ambience).toHaveBeenLastCalledWith(expect.any(String), true, false, 0, .4, true, 'deep_space')
  fireEvent.click(screen.getByRole('button', {name: 'Pause audio'}))
  expect(ambience.mock.lastCall?.[1]).toBe(false)
})
