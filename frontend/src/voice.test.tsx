// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { liveSocketUrl, useVoice } from './voice'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('uses the page host for WSS on HTTPS and the Vite proxy for WS locally', () => {
  expect(liveSocketUrl('https://aegis-example.onrender.com/mission').href).toBe('wss://aegis-example.onrender.com/api/live')
  expect(liveSocketUrl('http://127.0.0.1:5173/').href).toBe('ws://127.0.0.1:5173/api/live')
})

it('reuses audio and microphone across bounded backoff, ignores stale socket events, and stops cleanly', async () => {
  vi.useFakeTimers()
  const stopTrack = vi.fn()
  const closeContext = vi.fn().mockResolvedValue(undefined)
  const connectInput = vi.fn()
  const onActions = vi.fn()
  const sockets: Socket[] = []
  const contexts: Context[] = []
  class Socket {
    static OPEN = 1
    readyState = 1
    bufferedAmount = 0
    onmessage?: ((event: {data: string}) => void) | null
    onclose?: ((event: {code: number}) => void) | null
    close = vi.fn(() => { this.readyState = 3 })
    send = vi.fn()
    constructor() { sockets.push(this) }
  }
  class Context {
    state = 'running'
    currentTime = 0
    resume = vi.fn().mockResolvedValue(undefined)
    close = closeContext
    audioWorklet = {addModule: vi.fn().mockResolvedValue(undefined)}
    createMediaStreamSource() { return {connect: connectInput, disconnect: vi.fn()} }
    constructor() { contexts.push(this) }
  }
  class Worklet {
    port = {close: vi.fn(), onmessage: null}
    disconnect = vi.fn()
  }
  const getUserMedia = vi.fn().mockResolvedValue({getTracks: () => [{stop: stopTrack}]})
  vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}})
  vi.stubGlobal('AudioContext', Context)
  vi.stubGlobal('AudioWorkletNode', Worklet)
  vi.stubGlobal('WebSocket', Socket)

  const {result, unmount} = renderHook(() => useVoice('nominal', onActions))
  await act(async () => { await Promise.all([result.current.start(), result.current.start()]) })
  expect(sockets).toHaveLength(1)
  const listen = (socket: Socket) => socket.onmessage?.({data: '{"type":"state","value":"listening"}'})
  const stale = sockets[0].onmessage
  act(() => listen(sockets[0]))
  expect(result.current.state).toBe('listening')

  for (const delay of [500, 1500, 3500]) {
    const previous = sockets.at(-1)!
    act(() => previous.onclose?.({code: 1012}))
    expect(previous.close).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(delay) })
    act(() => listen(sockets.at(-1)!))
  }
  expect(sockets).toHaveLength(4)
  expect(contexts).toHaveLength(1)
  expect(getUserMedia).toHaveBeenCalledOnce()
  expect(connectInput).toHaveBeenCalledOnce()
  act(() => stale?.({data: '{"type":"actions","actions":[{"type":"navigate","section":"sleep"}]}'}))
  expect(onActions).not.toHaveBeenCalled()
  act(() => sockets[3].onclose?.({code: 1012}))
  expect(result.current.state).toBe('error')
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(closeContext).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(sockets).toHaveLength(4)
  unmount()
})


import { isQuietPlaybackEcho, OutputMeter } from './liveAudio'
import type { Simulation } from './simulation'

it('measures scheduled PCM only during playback and gates quiet residual audio only with a reference', () => {
  const meter = new OutputMeter()
  const buffer = {sampleRate: 100, getChannelData: () => new Float32Array(100).fill(.25)} as unknown as AudioBuffer
  meter.schedule(buffer, 2, .25, .3)
  expect(meter.read(1.9)).toBe(0)
  expect(meter.read(2.1)).toBeCloseTo(.25)
  expect(meter.read(2.31)).toBe(0)
  const quiet = new Int16Array(640).fill(120).buffer
  const speech = new Int16Array(640).fill(3500).buffer
  expect(isQuietPlaybackEcho(quiet, .25)).toBe(true)
  expect(isQuietPlaybackEcho(quiet, 0)).toBe(false)
  expect(isQuietPlaybackEcho(speech, .25)).toBe(false)
})

async function openPlayback(withoutMic = false) {
  vi.useFakeTimers()
  const played: ReturnType<typeof vi.fn>[] = []
  const stops: ReturnType<typeof vi.fn>[] = []
  const connections: ReturnType<typeof vi.fn>[] = []
  const destination = {}
  const sources: {onended?: (() => void) | null; buffer?: AudioBuffer}[] = []
  const sockets: Socket[] = []
  let clock = 0
  class Socket {
    static OPEN = 1
    readyState = 1
    bufferedAmount = 0
    close = vi.fn()
    send = vi.fn()
    onmessage?: (event: {data: string | ArrayBuffer}) => void
    onclose?: (event: {code: number}) => void
    constructor(readonly url: URL) { sockets.push(this) }
  }
  class Context {
    state = 'running'
    destination = destination
    get currentTime() {return clock}
    resume = vi.fn().mockResolvedValue(undefined)
    close = vi.fn().mockResolvedValue(undefined)
    audioWorklet = {addModule: vi.fn().mockResolvedValue(undefined)}
    createMediaStreamSource() {return {connect: vi.fn(), disconnect: vi.fn()}}
    createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
      const samples = new Float32Array(length)
      return {getChannelData: () => samples, length, numberOfChannels, sampleRate, duration: length / sampleRate}
    }
    createBufferSource() {
      const start = vi.fn(), stop = vi.fn()
      played.push(start); stops.push(stop)
      const connect = vi.fn()
      connections.push(connect)
      const source = {start, stop, connect, disconnect: vi.fn(), onended: null}
      sources.push(source)
      return source
    }
  }
  class Worklet {
    port = {close: vi.fn(), onmessage: null}
    disconnect = vi.fn()
  }
  const getUserMedia = withoutMic ? vi.fn().mockRejectedValue(new DOMException('Permiso denegado', 'NotAllowedError')) :
    vi.fn().mockResolvedValue({getTracks: () => [{stop: vi.fn()}]})
  vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}})
  vi.stubGlobal('AudioContext', Context)
  vi.stubGlobal('AudioWorkletNode', Worklet)
  vi.stubGlobal('WebSocket', Socket)
  const onActions = vi.fn()
  const {result, rerender, unmount} = renderHook(({day}) => useVoice('nominal', onActions, day), {initialProps: {day: 30}})
  await act(async () => {await result.current.start({allowNoMic: withoutMic})})
  const socket = sockets[0]
  const id = socket.url.searchParams.get('session_id')
  const event = (type: string, extra = {}) => socket.onmessage?.({data: JSON.stringify({type, ...extra})})
  const pcm = (sample = 6553) => socket.onmessage?.({data: new Int16Array(960).fill(sample).buffer})
  return {result, rerender, unmount, played, stops, sources, connections, destination, sockets, getUserMedia,
    event, pcm, id, setClock: (value: number) => { clock = value }}
}

it('can connect and play Gemini output without a microphone when launched from orbit', async () => {
  const {result, event, pcm, id, played, getUserMedia, unmount} = await openPlayback(true)
  expect(getUserMedia).toHaveBeenCalledOnce()
  expect(result.current.inputGraph).toBeUndefined()
  act(() => {
    event('state', {value: 'listening'})
    event('audio_format', {rate: 24000, channels: 1})
    event('audio_chunk', {session_id: id, turn: 1, sequence: 1})
    pcm()
  })
  expect(played).toHaveLength(1)
  expect(result.current.error).toMatch(/Micrófono no disponible/)
  unmount()
})

it('plays ordinary voice on the destination and distinguishes text-only and incompatible PCM', async () => {
  const {result, played, connections, destination, event, pcm, id, unmount, setClock} = await openPlayback()
  const turn = {session_id: id, turn: 1}
  act(() => {
    event('state', {value: 'listening'})
    event('state', {...turn, value: 'responding'})
  })
  expect(result.current.state).toBe('responding')
  act(() => {
    event('audio_format', {rate: 24000, channels: 1})
    event('audio_chunk', {...turn, sequence: 1})
    pcm()
  })
  expect(played).toHaveLength(1)
  expect(connections[0]).toHaveBeenCalledWith(destination)
  expect(result.current.state).toBe('receiving')
  act(() => { setClock(.04); vi.advanceTimersByTime(35) })
  expect(result.current.state).toBe('playing')
  unmount()

  const next = await openPlayback()
  act(() => {
    next.event('state', {value: 'listening'})
    next.event('transcript', {turn: 1, role: 'assistant', text: 'Hola'})
    next.event('turn_end', {turn: 1})
  })
  expect(next.result.current.state).toBe('text-only')
  expect(next.played).toHaveLength(0)
  act(() => {
    next.event('audio_format', {rate: 24000, channels: 1})
    next.pcm()
    next.event('turn_end', {turn: 2})
  })
  expect(next.result.current.state).toBe('audio-error')
  expect(next.result.current.diagnostics.rejected).toBe(1)
  expect(next.played).toHaveLength(0)
  next.unmount()
})

it('plays all ordinary speech in order after Gemini finishes generating faster than playback', async () => {
  const {result, played, sources, event, pcm, id, setClock, unmount} = await openPlayback()
  const turn = {session_id: id, turn: 1}
  act(() => {
    event('state', {value: 'listening'})
    event('audio_format', {rate: 24000, channels: 1})
    for (let sequence = 1; sequence <= 100; sequence++) {
      event('audio_chunk', {...turn, sequence})
      pcm(sequence)
    }
    event('transcript', {...turn, role: 'assistant', text: 'La respuesta ya está escrita.', finished: true})
    event('generation_end', turn)
    event('turn_end', turn)
  })
  expect(result.current.diagnostics.received).toBe(100)
  expect(result.current.diagnostics.pendingMs).toBeGreaterThanOrEqual(4000)
  act(() => {
    for (let tick = 1; tick <= 120; tick++) {
      const now = tick * .035
      setClock(now)
      sources.forEach((source, i) => {
        const [start, , duration] = played[i].mock.calls[0]
        if (start + duration <= now) source.onended?.()
      })
      vi.advanceTimersByTime(35)
    }
  })
  const samples = sources.map(source => source.buffer!.getChannelData(0)[0] * 32768)
  expect(samples.filter((sample, i) => i === 0 || sample !== samples[i - 1])).toEqual(
    Array.from({length: 100}, (_, i) => i + 1))
  expect(played.reduce((duration, start) => duration + start.mock.calls[0][2], 0)).toBeCloseTo(4)
  expect(result.current.diagnostics).toMatchObject({pendingMs: 0, droppedMs: 0})
  unmount()
})

it('drains accepted narration across scenario changes and endings, rejects stale frames, and honors interruption', async () => {
  const {result, rerender, unmount, played, stops, sources, sockets, getUserMedia, event, pcm, id, setClock} = await openPlayback()
  let clock = 0
  const turn = {session_id: id, turn: 1, event_id: 'panic', narrative_id: 'panic'}
  const frame = (sequence: number, metadata: Record<string, unknown> = turn) => {
    event('audio_chunk', {...metadata, sequence})
    pcm()
  }
  act(() => {
    result.current.acceptSimulation({event_id: 'panic', version: 2} as Simulation)
    event('state', {value: 'listening'})
    event('audio_format', {rate: 24000, channels: 1})
    event('narrative_start', turn)
    frame(1)
    frame(1)
  })
  expect(played).toHaveLength(1)
  expect(result.current.outputLevel).toBe(0)
  rerender({day: 29})
  act(() => {
    expect(result.current.acceptSimulation({event_id: 'nominal', version: 1} as Simulation)).toBe(false)
    expect(result.current.acceptSimulation({event_id: 'panic', version: 3} as Simulation)).toBe(true)
    expect(result.current.acceptSimulation({event_id: 'another-scenario', version: 4} as Simulation)).toBe(true)
    frame(2, {...turn, session_id: 'old-session'})
    event('generation_end', turn)
    frame(2)
    event('turn_end', turn)
    event('turn_end', turn)
    frame(3)
    setClock(clock = .055)
    vi.advanceTimersByTime(35)
  })
  expect(result.current.outputLevel).toBeGreaterThan(0)
  expect(played).toHaveLength(2)
  expect(played[1].mock.calls[0][0]).toBeCloseTo(.065)
  expect(stops.every(stop => !stop.mock.calls.length)).toBe(true)
  expect(sockets).toHaveLength(1)
  expect(getUserMedia).toHaveBeenCalledOnce()
  act(() => {
    const next = {...turn, turn: 2}
    frame(4, next)
    event('interrupt', turn)
    expect(stops.every(stop => !stop.mock.calls.length)).toBe(true)
    event('interrupt', next)
  })
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true)
  const previousSources = played.length
  const next = {...turn, turn: 3}
  act(() => {
    event('narrative_start', next)
    for (let sequence = 5; sequence < 85; sequence++) frame(sequence, next)
    event('turn_end', next)
  })
  expect(result.current.diagnostics.pendingMs).toBeGreaterThan(3000)
  expect(result.current.diagnostics.droppedMs).toBe(0)
  expect(result.current.turnStatus?.event).toBe('turn_end')
  act(() => {
    for (let tick = 0; tick < 105; tick++) {
      clock += .035
      setClock(clock)
      sources.forEach((source, i) => {
        const [start, , duration] = played[i].mock.calls[0]
        if (start + duration <= clock) source.onended?.()
      })
      vi.advanceTimersByTime(35)
    }
  })
  expect(played.slice(previousSources).reduce((duration, start) => duration + start.mock.calls[0][2], 0)).toBeCloseTo(3.2)
  expect(result.current.diagnostics.pendingMs).toBe(0)
  unmount()
})
