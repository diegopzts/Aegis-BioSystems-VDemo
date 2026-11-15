// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { App } from './App'

const {renderOrbital} = vi.hoisted(() => ({renderOrbital: vi.fn()}))
vi.mock('./OrbitalExperience', async importOriginal => {
  const original = await importOriginal<typeof import('./OrbitalExperience')>()
  return {default: (props: Parameters<typeof original.default>[0]) => {
    renderOrbital()
    return <original.default {...props}/>
  }}
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  renderOrbital.mockReset()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mockApi(config: Response | Error) {
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/config') {
      if (config instanceof Error) throw config
      return config.clone()
    }
    if (url === '/api/health') return Response.json({status: 'ok', geminiStatus: 'configured'})
    return Response.json({}, {status: 503})
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

it('boots the classic interface when the server disables orbital mode', async () => {
  const fetcher = mockApi(Response.json({orbitalUiEnabled: false}))
  await act(async () => { render(<App/>) })
  expect(fetcher).toHaveBeenCalledWith('/api/config', expect.anything())
  expect(screen.getByRole('heading', {name: 'Mission Overview'})).toBeTruthy()
  expect(screen.getByRole('region', {name: 'Monitor Tierra–Marte'})).toBeTruthy()
  expect(screen.queryByRole('heading', {name: 'Vista orbital'})).toBeNull()
  expect(screen.queryByText(/Experiencia orbital no disponible/)).toBeNull()
  expect(renderOrbital).not.toHaveBeenCalled()
})

it('uses orbital mode and switches the display without remounting Companion', async () => {
  mockApi(Response.json({orbitalUiEnabled: true}))
  const stopMic = vi.fn()
  const closeSocket = vi.fn()
  const closeAudio = vi.fn().mockResolvedValue(undefined)
  const startAudio = vi.fn()
  const stopAudio = vi.fn()
  const getUserMedia = vi.fn().mockResolvedValue({getTracks: () => [{stop: stopMic}]})
  const sockets: Socket[] = []
  class Socket {
    static OPEN = 1
    readyState = Socket.OPEN
    close = closeSocket
    send = vi.fn()
    onmessage?: (event: {data: string | ArrayBuffer}) => void
    constructor(readonly url: URL) { sockets.push(this) }
  }
  class Audio {
    state = 'running'
    currentTime = 0
    destination = {}
    audioWorklet = {addModule: vi.fn().mockResolvedValue(undefined)}
    resume = vi.fn().mockResolvedValue(undefined)
    close = closeAudio
    createAnalyser() { return {fftSize: 512, getFloatTimeDomainData: vi.fn(), disconnect: vi.fn()} }
    createMediaStreamSource() { return {connect: vi.fn(), disconnect: vi.fn()} }
    createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
      const samples = new Float32Array(length)
      return {numberOfChannels, length, sampleRate, duration: length / sampleRate, getChannelData: () => samples}
    }
    createBufferSource() { return {connect: vi.fn(), disconnect: vi.fn(), start: startAudio, stop: stopAudio} }
  }
  class Worklet {
    port = {close: vi.fn(), onmessage: null}
    disconnect = vi.fn()
  }
  vi.stubGlobal('AudioContext', Audio)
  vi.stubGlobal('AudioWorkletNode', Worklet)
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}})
  const greet = vi.fn()
  class Utterance {
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(readonly text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('Audio', class {
    play = vi.fn().mockRejectedValue(new Error('Archivo no disponible'))
    pause = vi.fn()
  })
  const natural = {name: 'Microsoft Aria Online (Natural)', lang: 'en-US'}
  vi.stubGlobal('speechSynthesis', {speak: greet, cancel: vi.fn(),
    getVoices: () => [{name: 'Microsoft David', lang: 'en-US'}, {name: 'Microsoft Zira', lang: 'en-US'}, natural]})

  render(<App/>)
  await screen.findByRole('heading', {name: 'Vista orbital'})
  await screen.findByText('System online')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  expect(getUserMedia).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Iniciar asistente'})) })
  expect(greet).toHaveBeenCalledOnce()
  expect(greet.mock.calls[0][0].text).toBe('Welcome to Aegis.')
  expect(greet.mock.calls[0][0].voice).toBe(natural)
  expect(sockets).toHaveLength(0)
  await act(async () => { greet.mock.calls[0][0].onend() })
  expect(sockets).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', {name: 'Abrir asistente'}))
  expect(greet).toHaveBeenCalledOnce()
  const socket = sockets[0]
  function emit(message: object) { socket.onmessage?.({data: JSON.stringify(message)}) }
  act(() => {
    emit({type: 'state', value: 'listening'})
    emit({type: 'audio_format', rate: 24000, channels: 1})
    emit({type: 'audio_chunk', turn: 1, sequence: 1, session_id: socket.url.searchParams.get('session_id')})
    socket.onmessage?.({data: new Int16Array(2400).buffer})
  })
  expect(startAudio).toHaveBeenCalledOnce()
  const draft = screen.getByRole('textbox', {name: 'Mensaje para AEGIS'}) as HTMLTextAreaElement
  fireEvent.change(draft, {target: {value: 'Consulta de misión sin enviar'}})
  const picker = screen.getByRole('combobox', {name: 'Experiencia visual'})
  fireEvent.change(picker, {target: {value: 'classic'}})
  expect(screen.queryByRole('heading', {name: 'Vista orbital'})).toBeNull()
  expect(localStorage.getItem('aegis-ui')).toBe('classic')
  expect(screen.getByRole('textbox', {name: 'Mensaje para AEGIS'})).toBe(draft)
  expect(draft.value).toBe('Consulta de misión sin enviar')
  fireEvent.change(picker, {target: {value: 'auto'}})
  await screen.findByRole('heading', {name: 'Vista orbital'})
  expect(screen.getByRole('textbox', {name: 'Mensaje para AEGIS'})).toBe(draft)
  expect(localStorage.getItem('aegis-ui')).toBeNull()
  expect(screen.getByRole('button', {name: 'Detener voz'})).toBeTruthy()
  expect(sockets).toHaveLength(1)
  expect(getUserMedia).toHaveBeenCalledOnce()
  expect(stopMic).not.toHaveBeenCalled()
  expect(closeSocket).not.toHaveBeenCalled()
  expect(closeAudio).not.toHaveBeenCalled()
  expect(stopAudio).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', {name: 'Signos vitales'}))
  expect(screen.getByRole('heading', {name: 'Vital Monitoring'})).toBeTruthy()
  fireEvent.click(screen.getByRole('button', {name: 'Volver a Órbita'}))
  expect(screen.getByRole('button', {name: 'Signos vitales'}).getAttribute('aria-current')).toBe('true')
  expect(closeSocket).not.toHaveBeenCalled()
  expect(stopAudio).not.toHaveBeenCalled()
})

it('rotates the belt with keyboard and wheel, then restores its position after opening a module', async () => {
  mockApi(Response.json({orbitalUiEnabled: true}))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  render(<App/>)
  const mission = await screen.findByRole('button', {name: /^Misión$/})
  expect(mission.getAttribute('aria-current')).toBe('true')
  await waitFor(() => expect(screen.queryByRole('heading', {name: 'Mission Overview'})).toBeNull())
  mission.focus()
  fireEvent.keyDown(mission, {key: 'ArrowRight'})
  const vitals = screen.getByRole('button', {name: 'Signos vitales'})
  expect(document.activeElement).toBe(vitals)
  expect(vitals.getAttribute('aria-current')).toBe('true')
  const belt = vitals.parentElement!
  fireEvent.wheel(belt, {deltaY: 110})
  expect(screen.getByRole('button', {name: 'Sueño'}).getAttribute('aria-current')).toBe('true')
  fireEvent.wheel(document.body, {deltaY: 110})
  const pointer = (kind: string, clientX: number) => Object.assign(
    new MouseEvent(kind, {bubbles: true, clientX, button: 0}), {pointerId: 1, isPrimary: true})
  fireEvent(belt, pointer('pointerdown', 150))
  fireEvent(belt, pointer('pointermove', 100))
  fireEvent(belt, pointer('pointerup', 100))
  expect(screen.getByRole('button', {name: 'Bienestar'}).getAttribute('aria-current')).toBe('true')
  fireEvent.click(screen.getByRole('button', {name: 'Sueño'}))
  expect(screen.getByRole('heading', {name: 'Sleep Intelligence'})).toBeTruthy()
  fireEvent.click(screen.getByRole('button', {name: 'Volver a Órbita'}))
  const sleep = screen.getByRole('button', {name: 'Sueño'})
  expect(sleep.getAttribute('aria-current')).toBe('true')
  expect(document.activeElement).toBe(sleep)
})

it.each(['url', 'local'])('forces classic from the %s without fetching orbital configuration', async source => {
  if (source === 'url') window.history.replaceState(null, '', '/?aegis-ui=classic')
  else localStorage.setItem('aegis-ui', 'classic')
  const fetcher = mockApi(Response.json({orbitalUiEnabled: true}))
  await act(async () => { render(<App/>) })
  expect(fetcher.mock.calls.some(([url]) => url === '/api/config')).toBe(false)
  expect(screen.getByRole('heading', {name: 'Mission Overview'})).toBeTruthy()
  expect(screen.queryByRole('heading', {name: 'Vista orbital'})).toBeNull()
  expect(renderOrbital).not.toHaveBeenCalled()
})

it.each([
  new Error('Sin conexión'),
  Response.json({}, {status: 503}),
  Response.json({orbitalUiEnabled: 'true'}),
])('falls back to classic when configuration cannot be read', async response => {
  mockApi(response)
  render(<App/>)
  expect(screen.getByRole('heading', {name: 'Mission Overview'})).toBeTruthy()
  await screen.findByText(/Experiencia orbital no disponible/)
  expect(screen.getByRole('region', {name: 'Monitor Tierra–Marte'})).toBeTruthy()
  expect(screen.queryByRole('heading', {name: 'Vista orbital'})).toBeNull()
})

it('keeps the classic interface available if the optional orbital view throws', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  renderOrbital.mockImplementation(() => { throw new Error('Vista orbital interrumpida') })
  mockApi(Response.json({orbitalUiEnabled: true}))
  render(<App/>)
  await screen.findByText(/Experiencia orbital no disponible/)
  expect(screen.getByRole('heading', {name: 'Mission Overview'})).toBeTruthy()
  expect(screen.getByRole('region', {name: 'Monitor Tierra–Marte'})).toBeTruthy()
  await waitFor(() => expect(renderOrbital).toHaveBeenCalled())
})
