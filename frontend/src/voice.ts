import { useCallback, useEffect, useRef, useState } from 'react'
import { actionList, changeSchema, type Action, type Change, type Scenario, type WorkspaceView } from './contracts'
import { decodePcm, PlaybackQueue } from './playback'
import { isQuietNarrationEcho, OutputMeter, splitNarration } from './liveAudio'
import { acquireAudio } from './audioContext'
import { simulationSchema, type Simulation } from './simulation'

export type VoiceState = 'disconnected' | 'connecting' | 'listening' | 'responding' | 'receiving' | 'playing' |
  'recovering' | 'suspended' | 'text-only' | 'no-audio' | 'audio-error' | 'error'
type Transcript = {id: string; role: 'user' | 'assistant'; text: string; finished: boolean}
type Diagnostics = {pendingMs: number; chunks: number; droppedMs: number; reconnects: number; interruptions: number; received: number; rejected: number}
const emptyDiagnostics = {pendingMs: 0, chunks: 0, droppedMs: 0, reconnects: 0, interruptions: 0, received: 0, rejected: 0}
type TurnInfo = {turn: number; narrative: string | null; event?: string}
const backoff = [500, 1500, 3500]

export function liveSocketUrl(page: string) {
  const url = new URL('/api/live', page)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

type Session = {
  context: AudioContext; releaseAudio: () => Promise<void>; queue: PlaybackQueue; stream?: MediaStream; socket?: WebSocket;
  capture?: AudioWorkletNode; input?: MediaStreamAudioSourceNode; timer?: number; retry?: number;
  id: string; handshake?: number; reconnects: number; connection: number; linked: boolean; interruptions: number;
  ready: boolean; responding: boolean; recoverUntil: number; meter: OutputMeter;
  drain?: () => void; narrative?: TurnInfo; staged: AudioBuffer[]; stagedSeconds: number
  received: number; rejected: number; outcome?: 'text-only' | 'no-audio' | 'audio-error'
}

function closeSocket(session: Session) {
  window.clearTimeout(session.handshake)
  session.ready = false
  const socket = session.socket
  session.socket = undefined
  if (socket) {
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    socket.close()
  }
}

function clearAudio(session: Session) {
  session.queue.clear()
  session.meter.clear()
  session.staged.length = 0
  session.stagedSeconds = 0
}

function release(session: Session) {
  window.clearTimeout(session.retry)
  window.clearInterval(session.timer)
  closeSocket(session)
  session.context.onstatechange = null
  if (session.capture) {
    session.capture.port.onmessage = null
    session.capture.port.close()
    session.capture.disconnect()
  }
  session.input?.disconnect()
  session.stream?.getTracks().forEach(track => track.stop())
  clearAudio(session)
  return session.releaseAudio()
}

export function useVoice(scenario: Scenario, onActions: (actions: Action[]) => void, day = 30,
  onChange?: (change: Change) => void, ui?: WorkspaceView, onSimulation?: (value: Simulation) => void) {
  const sessionRef = useRef<Session | null>(null)
  const closing = useRef<Promise<void> | null>(null)
  const opening = useRef(false)
  const permissionPending = useRef(false)
  const ticket = useRef(0)
  const latest = useRef({scenario, day, ui, onActions, onChange, onSimulation})
  latest.current = {scenario, day, ui, onActions, onChange, onSimulation}
  const [inputGraph, setInputGraph] = useState<{context: AudioContext; input: MediaStreamAudioSourceNode}>()
  const simulationRef = useRef<Simulation | undefined>(undefined)
  const [outputLevel, setOutputLevel] = useState(0)
  const [turnStatus, setTurnStatus] = useState<{session: string; turn: number; narrative: string | null; event: string} | null>(null)
  const acceptSimulation = useCallback((value: Simulation) => {
    const previous = simulationRef.current
    if (previous && value.version <= previous.version) return false
    simulationRef.current = value
    return true
  }, [])
  const [state, setState] = useState<VoiceState>('disconnected')
  const [error, setError] = useState('')
  const [diagnostics, setDiagnostics] = useState(emptyDiagnostics)
  const [transcripts, setTranscripts] = useState<Transcript[]>([])
  const cleanup = useCallback(() => {
    ticket.current++
    const session = sessionRef.current
    sessionRef.current = null
    if (session) {
      const completion = release(session)
      closing.current = completion
      void completion.finally(() => { if (closing.current === completion) closing.current = null })
    }
  }, [])
  const stop = useCallback(() => {
    cleanup(); setOutputLevel(0); setTurnStatus(null); setInputGraph(undefined); setState('disconnected'); setError(''); setDiagnostics(emptyDiagnostics)
  }, [cleanup])
  const clearTranscripts = useCallback(() => setTranscripts([]), [])
  useEffect(() => cleanup, [cleanup])
  useEffect(() => {
    const socket = sessionRef.current?.socket
    if (socket?.readyState === WebSocket.OPEN && ui) socket.send(JSON.stringify({position: {scenario, day}, ui}))
  }, [scenario, day, ui?.section, ui?.metric, ui?.range, ui?.region, ui?.view])

  function fail(message: string) {
    cleanup()
    setInputGraph(undefined)
    setOutputLevel(0)
    setError(message)
    setState('error')
  }

  async function resume() {
    const session = sessionRef.current
    if (!session) return
    try {
      await session.context.resume()
      if (sessionRef.current !== session) return
      if (session.context.state !== 'running') setError('El navegador sigue pausando el audio. Pulsa Reanudar audio.')
      else setError('')
    } catch {
      if (sessionRef.current === session) setError('El navegador bloqueó la reproducción. Pulsa Reanudar audio.')
    }
  }

  async function start() {
    if (sessionRef.current || opening.current || permissionPending.current) return
    opening.current = true
    const version = ++ticket.current
    setError('')
    setState('connecting')
    setDiagnostics(emptyDiagnostics)
    setTranscripts([])
    let session: Session
    try {
      if (closing.current) await closing.current
      if (version !== ticket.current) return
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('El micrófono requiere localhost o HTTPS.')
      const lease = await acquireAudio()
      if (version !== ticket.current) { await lease.release(); return }
      const context = lease.context
      const meter = new OutputMeter()
      session = {context, meter, id: crypto.randomUUID(), releaseAudio: lease.release,
        queue: new PlaybackQueue(context, (buffer, start, offset, duration) => meter.schedule(buffer, start, offset, duration)), reconnects: 0, connection: 0, interruptions: 0,
        linked: false, ready: false, responding: false, recoverUntil: 0, staged: [], stagedSeconds: 0, received: 0, rejected: 0}
      sessionRef.current = session
      await context.resume()
      if (version !== ticket.current) return
      if (context.state !== 'running') throw new Error('El navegador bloqueó el audio. Pulsa Reconectar para intentarlo de nuevo.')
      permissionPending.current = true
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true}})
      } finally { permissionPending.current = false }
      if (version !== ticket.current) { stream.getTracks().forEach(track => track.stop()); return }
      session.stream = stream
      await context.audioWorklet.addModule('/pcm-capture.js')
      if (version !== ticket.current) return
      const capture = new AudioWorkletNode(context, 'pcm-capture', {numberOfOutputs: 0})
      session.capture = capture
      session.input = context.createMediaStreamSource(stream)
      setInputGraph({context, input: session.input})
      capture.port.onmessage = ({data}: MessageEvent<ArrayBuffer>) => {
        const socket = session.socket
        if (session.ready && socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 32_768) {
          const rms = session.narrative ? session.meter.read(session.context.currentTime) : 0
          socket.send(isQuietNarrationEcho(data, rms) ? new ArrayBuffer(data.byteLength) : data)
        }
      }
    } catch (error) {
      if (version === ticket.current) {
        const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
        fail(denied ? 'Permite el micrófono en el navegador y pulsa Reconectar.' :
          error instanceof Error ? error.message : 'No se pudo iniciar el micrófono.')
      }
      return
    } finally { opening.current = false }

    function updatePlayback() {
      if (sessionRef.current !== session) return
      // Narrative PCM can arrive faster than real time. Admit it below the existing queue's
      // overflow threshold, without changing its playback cursor or live conversation policy.
      while (session.staged.length && session.queue.diagnostics.pendingMs + session.staged[0].duration * 1000 < 1250 &&
          session.queue.diagnostics.chunks < 96) {
        const buffer = session.staged.shift()!
        session.stagedSeconds = Math.max(0, session.stagedSeconds - buffer.duration)
        session.queue.push(buffer)
      }
      try { session.queue.pump() }
      catch { fail('El navegador no pudo conectar o iniciar la salida de voz.'); return }
      const stats = session.queue.diagnostics
      stats.pendingMs += Math.round(session.stagedSeconds * 1000)
      stats.chunks += session.staged.length
      const running = session.context.state === 'running'
      setOutputLevel(running ? Math.round(Math.min(1, session.meter.read(session.context.currentTime) * 5) * 100) : 0)
      if (!stats.chunks && !stats.pendingMs && !session.responding) session.narrative = undefined
      if (!stats.chunks && !stats.pendingMs && session.drain) {
        const resumeConnection = session.drain
        session.drain = undefined
        resumeConnection()
        return
      }
      setDiagnostics(previous => previous.pendingMs === stats.pendingMs && previous.chunks === stats.chunks &&
        previous.droppedMs === stats.droppedMs && previous.reconnects === session.reconnects && previous.interruptions === session.interruptions &&
        previous.received === session.received && previous.rejected === session.rejected
        ? previous : {...stats, reconnects: session.reconnects, interruptions: session.interruptions, received: session.received, rejected: session.rejected})
      if (session.context.state !== 'running') { setState('suspended'); return }
      if (!session.ready) { setState('connecting'); return }
      if (performance.now() < session.recoverUntil) setState('recovering')
      else if (session.meter.playing(session.context.currentTime)) setState('playing')
      else if (stats.chunks || stats.pendingMs) setState('receiving')
      else setState(session.outcome ?? (session.responding ? 'responding' : 'listening'))
    }
    session.context.onstatechange = updatePlayback
    session.timer = window.setInterval(updatePlayback, 35)

    function reconnect(message: string) {
      closeSocket(session)
      session.responding = false
      if (session.staged.length || session.queue.diagnostics.chunks || session.queue.diagnostics.pendingMs) {
        session.drain = () => reconnect(message)
        return
      }
      session.meter.clear()
      session.narrative = undefined
      session.outcome = undefined
      session.recoverUntil = 0
      if (session.reconnects >= backoff.length) { fail(message); return }
      const delay = backoff[session.reconnects++]
      setState('connecting')
      session.retry = window.setTimeout(connect, delay)
    }

    function connect() {
      if (sessionRef.current !== session || session.socket) return
      session.connection++
      const current = latest.current
      const url = liveSocketUrl(location.href)
      url.searchParams.set('scenario', current.scenario)
      url.searchParams.set('day', String(current.day))
      url.searchParams.set('session_id', session.id)
      if (current.ui) url.searchParams.set('ui', JSON.stringify(current.ui))
      let socket: WebSocket
      try { socket = new WebSocket(url) }
      catch { reconnect('No se pudo conectar a Gemini Live.'); return }
      session.socket = socket
      socket.binaryType = 'arraybuffer'
      const isCurrent = () => sessionRef.current === session && session.socket === socket
      let pendingChunk: TurnInfo | undefined
      let lastSequence = 0
      let terminalTurn = 0
      let activeTurn = 0
      let interruptTurn = 0
      let turnReceived = 0
      let turnRejected = 0
      let turnText = false
      let discardedHeader = false
      let unframed = false
      let format: {rate: number; channels: number} | undefined
      const beginTurn = (turn: number) => {
        if (turn <= activeTurn) return
        activeTurn = turn
        turnReceived = turnRejected = 0
        turnText = false
        session.outcome = undefined
      }
      session.handshake = window.setTimeout(() => {
        if (isCurrent()) reconnect('Gemini Live no respondió al conectar.')
      }, 20_000)
      socket.onopen = () => {
        const current = latest.current
        if (current.ui && isCurrent()) socket.send(JSON.stringify({position: {scenario: current.scenario, day: current.day}, ui: current.ui}))
      }
      socket.onclose = ({code}) => {
        if (!isCurrent()) return
        if (code === 1008 || code === 1003) fail('Gemini Live rechazó la conexión de voz.')
        else reconnect('Se perdió la conexión de voz. Pulsa Reconectar.')
      }
      socket.onerror = () => {
        if (isCurrent()) reconnect('No se pudo conectar a Gemini Live.')
      }
      socket.onmessage = ({data}: MessageEvent<string | ArrayBuffer>) => {
        if (!isCurrent()) return
        if (typeof data !== 'string') {
          const metadata = pendingChunk
          pendingChunk = undefined
          const ignored = discardedHeader
          discardedHeader = false
          if (ignored || (metadata && (metadata.turn <= Math.max(terminalTurn, interruptTurn) || metadata.turn < activeTurn))) return
          if (metadata) beginTurn(metadata.turn)
          let buffer: AudioBuffer | undefined
          try { buffer = metadata && format ? decodePcm(data, format.rate, format.channels, session.context) : undefined }
          catch { fail('El navegador no pudo preparar el audio de Gemini.'); return }
          if (buffer) {
            turnReceived++
            session.received++
            session.responding = true
            if (metadata?.narrative || session.staged.length) {
              if (session.stagedSeconds + buffer.duration > 90 || session.staged.length >= 2048) {
                fail('Gemini envió más audio del que la narrativa puede conservar. Reconecta para continuar.')
                return
              }
              for (const part of splitNarration(buffer, session.context)) session.staged.push(part)
              session.stagedSeconds += buffer.duration
            } else if (session.queue.push(buffer)) session.recoverUntil = performance.now() + 800
          } else {
            if (!metadata) unframed = true
            turnRejected++
            session.rejected++
            session.outcome = 'audio-error'
          }
          updatePlayback()
          return
        }
        let event
        try { event = JSON.parse(data) } catch { return }
        if (!event || typeof event !== 'object') return
        if (event.session_id != null && event.session_id !== session.id) {
          if (event.type === 'audio_chunk') { pendingChunk = undefined; discardedHeader = true }
          return
        }
        const hasTurn = Number.isSafeInteger(event.turn) && event.turn > 0
        const currentTurn = hasTurn && event.turn > terminalTurn && event.turn >= activeTurn
        const report = () => setTurnStatus({session: session.id, turn: event.turn,
          narrative: event.narrative_id ?? null, event: event.type})
        switch (event.type) {
          case 'audio_chunk':
            pendingChunk = undefined
            discardedHeader = true
            if (currentTurn && Number.isSafeInteger(event.sequence) && event.sequence > lastSequence) {
              lastSequence = event.sequence
              pendingChunk = {turn: event.turn, narrative: event.narrative_id ?? null, event: event.event_id}
              discardedHeader = false
            }
            break
          case 'narrative_start':
            if (currentTurn) {
              beginTurn(event.turn)
              session.narrative = {turn: event.turn, narrative: event.narrative_id}
              session.responding = true
              report()
            }
            break
          case 'provider_closing':
          case 'generation_end':
            if (currentTurn) report()
            break
          case 'simulation': {
            const parsed = simulationSchema.safeParse(event.snapshot)
            if (parsed.success && acceptSimulation(parsed.data)) latest.current.onSimulation?.(parsed.data)
            break
          }
          case 'audio_format':
            format = {rate: event.rate, channels: event.channels}
            break
          case 'error': {
            const message = typeof event.message === 'string' ? event.message : 'Gemini Live no está disponible.'
            if (event.retryable === true) reconnect(message)
            else fail(message)
            return
          }
          case 'state':
            if (hasTurn && !currentTurn) break
            if (event.value === 'listening') {
              window.clearTimeout(session.handshake)
              session.ready = true
              session.responding = false
              if (!session.linked) { session.input?.connect(session.capture!); session.linked = true }
            }
            if (event.value === 'responding') {
              if (hasTurn) beginTurn(event.turn)
              session.responding = true
            }
            break
          case 'interrupt':
            if (!currentTurn || event.turn <= interruptTurn) break
            interruptTurn = event.turn
            session.interruptions++
            pendingChunk = undefined
            clearAudio(session)
            session.narrative = undefined
            setOutputLevel(0)
            report()
            session.recoverUntil = 0
            session.responding = false
            break
          case 'turn_end':
            if (!currentTurn) break
            beginTurn(event.turn)
            terminalTurn = event.turn
            pendingChunk = undefined
            session.responding = false
            session.outcome = turnRejected || unframed ? 'audio-error' : turnReceived || interruptTurn === event.turn ? undefined :
              turnText ? 'text-only' : 'no-audio'
            unframed = false
            report()
            setTranscripts(previous => previous.map(item => item.id.startsWith(`${session.connection}:${event.turn}:`) ?
              {...item, finished: true} : item))
            break
          case 'transcript': {
            if (!currentTurn || !['user', 'assistant'].includes(event.role) || typeof event.text !== 'string') break
            beginTurn(event.turn)
            if (event.role === 'assistant') {
              turnText = true
              session.responding = true
            }
            const id = `${session.connection}:${event.turn}:${event.role}`
            setTranscripts(previous => {
              const existing = previous.find(item => item.id === id)
              if (existing?.finished) return previous
              const piece = event.text as string
              const text = !existing || piece.startsWith(existing.text) ? piece : existing.text + piece
              const item = {id, text: text.slice(0, 4000), role: event.role, finished: event.finished === true}
              return [...previous.filter(row => row.id !== id), item].slice(-16)
            })
            break
          }
          case 'actions': {
            if (hasTurn && !currentTurn) break
            const parsed = actionList.safeParse(event.actions)
            if (parsed.success) latest.current.onActions(parsed.data)
            break
          }
          case 'change': {
            if (hasTurn && !currentTurn) break
            const parsed = changeSchema.safeParse(event.change)
            if (parsed.success) latest.current.onChange?.(parsed.data)
            break
          }
        }
        updatePlayback()
      }
    }

    connect()
  }

  return {state, error, start, stop, resume, diagnostics, transcripts, clearTranscripts, inputGraph, acceptSimulation, outputLevel, turnStatus}
}

