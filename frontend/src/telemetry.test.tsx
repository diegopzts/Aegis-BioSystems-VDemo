// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {MoodConstellation} from './MoodConstellation'
import {smoothVocalActivity, VoiceOrb} from './VoiceOrb'
import type {MoodEntry} from './contracts'
import type {InputGraph} from './simulation'

afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()})

const entry: MoodEntry = {id: 12, mood: 4, stress: 2, energy: 4,
  day: 30, date: '2026-11-14', recordedAt: '2026-11-14T18:00:00Z', source: 'checkin', notes: '<b>Texto personal</b>'}

it('smooths synthetic amplitude over successive frames and bounds it', () => {
  const voice = new Float32Array(512).fill(.18)
  const silence = new Float32Array(512)
  const first = smoothVocalActivity(voice, 0)
  expect(first).toBeGreaterThan(0)
  expect(first).toBeLessThan(25)
  const next = smoothVocalActivity(voice, first)
  expect(next).toBeGreaterThan(first)
  expect(smoothVocalActivity(silence, next)).toBeLessThan(next)
  let last = 0
  for (let i = 0; i < 100; i++) last = smoothVocalActivity(new Float32Array([1, -1]), last)
  expect(last).toBeGreaterThan(99)
  expect(last).toBeLessThanOrEqual(100)
})

it('uses only the existing mic node, leaves the output disconnected and cleans up', () => {
  vi.useFakeTimers()
  const getUserMedia = vi.fn()
  vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}})
  const analyser = {fftSize: 512, getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(.18)),
    disconnect: vi.fn(), connect: vi.fn()}
  const input = {connect: vi.fn(), disconnect: vi.fn()}
  const graph = {context: {state: 'running', createAnalyser: () => analyser}, input} as unknown as InputGraph
  const {rerender} = render(<VoiceOrb/>)
  expect(screen.getByText('No disponible')).toBeTruthy()
  rerender(<VoiceOrb graph={graph}/>)
  act(() => vi.advanceTimersByTime(200))
  expect(screen.getByText(/\d+\/100/)).toBeTruthy()
  expect(input.connect).toHaveBeenCalledExactlyOnceWith(analyser)
  expect(analyser.connect).not.toHaveBeenCalled()
  expect(getUserMedia).not.toHaveBeenCalled()
  rerender(<VoiceOrb/>)
  expect(screen.getByText('No disponible')).toBeTruthy()
  expect(input.disconnect).toHaveBeenCalledWith(analyser)
  expect(analyser.disconnect).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('positions real IDs, supports keyboard details, and renders notes as plain text', () => {
  render(<MoodConstellation history={[entry, {...entry, id: 13, stress: null}]}/>)
  const star = screen.getByRole('button', {name: 'ID 12, Bien, estrés 2/5, energía 4/5'})
  expect(star.getAttribute('data-position')).toBe('158,70')
  expect(screen.getByRole('button', {name: /ID 13.*estrés Sin dato/}).getAttribute('data-position')).toBe('502,70')
  fireEvent.focus(star)
  expect(within(screen.getByRole('tooltip')).getByText('<b>Texto personal</b>')).toBeTruthy()
  fireEvent.keyDown(star, {key: 'Enter'})
  expect(screen.getByRole('region', {name: 'Detalle del autorregistro'}).textContent).toContain('ID 12')
  fireEvent.click(screen.getByText('Lista accesible de autorregistros'))
  expect(screen.getByRole('button', {name: 'Ver detalle de ID 12'})).toBeTruthy()
})

it('keeps star identity on confirmed edits and removes a confirmed delete after its exit transition', () => {
  vi.useFakeTimers()
  const {container, rerender} = render(<MoodConstellation history={[entry]}/>)
  const star = screen.getByRole('button', {name: /^ID 12/})
  rerender(<MoodConstellation history={[{...entry, stress: 5}]}/>)
  expect(screen.getByRole('button', {name: /^ID 12/})).toBe(star)
  expect(star.getAttribute('data-position')).toBe('434,70')
  rerender(<MoodConstellation history={[]}/>)
  expect(screen.queryByRole('button', {name: /^ID 12/})).toBeNull()
  expect(container.querySelector('[data-leaving=true]')).toBe(star)
  act(() => vi.advanceTimersByTime(220))
  expect(container.querySelector('.constellation-star')).toBeNull()
})

it('removes the ghost immediately when motion is reduced', () => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({matches: true}))
  const {container, rerender} = render(<MoodConstellation history={[entry]}/>)
  rerender(<MoodConstellation history={[]}/>)
  expect(container.querySelector('.constellation-star')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})


import {OrbitalMonitor} from './OrbitalMonitor'

it('positions AEGIS-1 using mission progress and exposes the autonomous link state', () => {
  const orbital = {distance_million_km: 377.74, one_way_seconds: 1260, one_way_label: '21 min 00 s',
    link_status: 'normal', link_label: 'Enlace nominal', autonomous_override: false, synthetic: true} as const
  const {rerender} = render(<OrbitalMonitor orbital={orbital} day={30} plannedDays={120}/>)
  expect(screen.getByRole('img', {name: /AEGIS-1, 25%/}).style.left).toBe('25%')
  rerender(<OrbitalMonitor orbital={{...orbital, autonomous_override: true, link_status: 'warning'}} day={150} plannedDays={120}/>)
  expect(screen.getByRole('img', {name: /100%.*nodo autónomo/}).style.left).toBe('100%')
})
