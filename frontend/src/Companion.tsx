import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react'
import { AudioLines, Mic, Send, Sparkles, Square, X } from 'lucide-react'
import { post, request, useResource } from './api'
import { changeSchema, replySchema, type Action, type Change, type Message, type Position, type WorkspaceView } from './contracts'
import { CheckinSettings, type CheckinPromptState } from './checkinPrompt'
import { useVoice, type VoiceState } from './voice'
import { VoiceOrb } from './VoiceOrb'
import type { InputGraph, Simulation } from './simulation'

const greeting = '¿Cómo estás, cómo te sientes hoy?'
const prompts = [
  ['Hablar de cómo me siento', 'Quiero hablar un poco de cómo me siento.'],
  ['Revisar mi descanso', '¿Qué muestran mis registros de sueño más recientes?'],
  ['Ver tendencias de bienestar', '¿Cómo han variado mi energía y estrés durante los últimos 7 días?'],
  ['Hacer una pausa breve', '¿Podemos hacer un ejercicio breve y opcional para hacer una pausa?'],
]
const voiceLabels = {
  disconnected: 'Voz desconectada', connecting: 'Conectando…', listening: 'Escuchando',
  responding: 'Generando voz…', receiving: 'Recibiendo audio…', playing: 'Reproduciendo voz',
  suspended: 'Voz silenciada: audio pausado por el navegador', error: 'Error de voz',
  'text-only': 'Solo transcripción: Gemini no envió audio', 'no-audio': 'Gemini terminó sin audio',
  'audio-error': 'Error de voz: audio incompatible con esta versión',
}
const operations: Record<string, string> = {
  create_wellness_entry: 'Crear registro', update_wellness_entry: 'Editar registro', delete_wellness_entry: 'Quitar registro',
  acknowledge_alert: 'Revisar alerta', set_mission_scenario: 'Cambiar escenario', advance_mission: 'Avanzar un día',
  reset_mission: 'Reiniciar simulación', undo: 'Deshacer cambio',
}
type Activity = {id: number; operation: string; target: string; date: string; result: string; undoable: boolean}
export type CompanionVoiceStatus = {label: string; playing: boolean; graph?: InputGraph; state: VoiceState; output: number}
export type CompanionControls = {startFromOrbit: (welcome: () => Promise<void>) => void}
type Props = {
  context: Position; ui: WorkspaceView; visible: boolean; breathing?: boolean; simulation?: Simulation;
  onSimulation: (value: Simulation) => void;
  onVoiceStatus: (value: CompanionVoiceStatus) => void;
  ref?: Ref<CompanionControls>; orbital?: boolean; waitForWelcome?: () => Promise<void>;
  availability: 'configured' | 'unconfigured' | 'checking' | 'error'; onActions: (actions: Action[]) => void;
  onChange: (change: Change) => void; close: () => void; checkin: CheckinPromptState
}

export function Companion({context, ui, visible, breathing, simulation, onSimulation, onVoiceStatus, availability, onActions, onChange, close, checkin, ref, orbital, waitForWelcome}: Props) {
  const {scenario, day} = context
  const [messages, setMessages] = useState<Message[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [revision, setRevision] = useState(0)
  const activity = useResource<Activity[]>('companion/activity', revision, true)
  const requestController = useRef<AbortController | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const voice = useVoice(scenario, onActions, day, showChange, ui, onSimulation)
  const {acceptSimulation, inputGraph, state: playbackState, diagnostics} = voice
  const playing = diagnostics.pendingMs > 0 && playbackState !== 'suspended'
  useEffect(() => {
    onVoiceStatus({label: voiceLabels[playbackState], playing, graph: inputGraph, state: playbackState, output: voice.outputLevel})
  }, [onVoiceStatus, playbackState, playing, inputGraph, voice.outputLevel])
  const greetingTranscribed = voice.transcripts.some(item => item.role === 'assistant' && item.text.includes(greeting))
  useEffect(() => { if (simulation) acceptSimulation(simulation) }, [simulation, acceptSimulation])
  const configured = availability === 'configured'
  const speaking = voice.state !== 'disconnected' && voice.state !== 'error'
  useImperativeHandle(ref, () => ({
    startFromOrbit(welcome) {
      if (configured) void voice.start({welcome, allowNoMic: true})
      else if (!speaking) void welcome()
    },
  }))

  useEffect(() => { if (visible) input.current?.focus(); else voice.stop() }, [visible, voice.stop])
  useEffect(() => { if (visible) end.current?.scrollIntoView?.({block: 'nearest'}) }, [visible, messages, pending])
  useEffect(() => {
    requestController.current?.abort()
    setPending(false)
  }, [scenario, day])
  useEffect(() => () => requestController.current?.abort(), [])

  function clear() {
    requestController.current?.abort()
    voice.stop()
    voice.clearTranscripts()
    setMessages([])
    setSources([])
    setText('')
    setError('')
    setResult('')
    setPending(false)
  }

  async function send(form: FormEvent) {
    form.preventDefault()
    const message = text.trim()
    if (!message || pending || busy || !configured) return
    const controller = new AbortController()
    requestController.current = controller
    const timeout = window.setTimeout(() => controller.abort('timeout'), 65_000)
    const previous = messages
    const next: Message[] = [...previous, {role: 'user', text: message}]
    setMessages(next)
    setText('')
    setError('')
    setResult('')
    setSources([])
    setPending(true)
    try {
      const reply = replySchema.parse(await request('chat', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.signal,
        body: JSON.stringify({scenario, day, ui, messages: next.slice(-13)}),
      }))
      if (controller.signal.aborted) return
      setMessages([...next.slice(-29), {role: 'assistant', text: reply.reply}])
      setSources(reply.sources)
      reply.changes.forEach(showChange)
      onActions(reply.actions)
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') return
      setMessages(previous)
      setText(message)
      setError(controller.signal.aborted ? 'Se agotó el tiempo de espera.' : error instanceof Error ? error.message : 'No pude comunicarme con Gemini.')
    } finally {
      window.clearTimeout(timeout)
      if (requestController.current === controller) setPending(false)
    }
  }

  function showChange(change: Change) {
    onChange(change)
    setRevision(old => old + 1)
    const id = change.record.id
    setResult(`Guardado · ${operations[change.operation] ?? 'Cambio aplicado'}${id ? ` · #${id}` : ''}`)
  }

  async function undo(id: number) {
    setBusy(true)
    setError('')
    setResult('')
    try {
      showChange(changeSchema.parse(await post<unknown>(`companion/activity/${id}/undo`, {})))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo deshacer el cambio.')
    } finally { setBusy(false) }
  }

  return <aside hidden={!visible} className="companion panel" aria-label="AEGIS AI Companion" lang="es" onKeyDown={e => { if (e.key === 'Escape') close() }}>
    <header className="companion-header"><div className="section-icon"><Sparkles size={20}/></div>
      <div><h2>AEGIS AI Companion</h2><p>Bienestar durante la misión · Google Gemini</p></div>
      <button className="icon-button" onClick={close} aria-label="Cerrar asistente"><X size={18}/></button>
    </header>
    {visible && !orbital && <VoiceOrb graph={inputGraph} breathing={breathing} output={voice.outputLevel} state={voice.state}
      label={voiceLabels[voice.state]} alert={Boolean(simulation && simulation.scenario_id !== 'nominal')}/>}
    <div className="chat-log">
      <p className="muted">AEGIS es una demostración con datos sintéticos y no sustituye el apoyo de profesionales de salud mental.</p>
      <p className="muted">El Companion consulta los datos de AEGIS y puede hacer cambios que le pidas. Gemini procesa los mensajes y los datos consultados, incluidas observaciones de bienestar cuando aportan a tu pregunta.</p>
      <details className="companion-details"><summary>Configurar check-ins</summary><CheckinSettings prompt={checkin}/></details>
      <details className="companion-details"><summary>Actividad local</summary>
        {activity.error && <button className="button" onClick={activity.retry}>Reintentar actividad</button>}
        {!activity.data?.length && <p>Sin cambios registrados.</p>}
        {activity.data?.map(item => <div key={item.id} className="activity-item">
          <span>{operations[item.operation] ?? item.operation} · aplicado<br/><time dateTime={item.date}>{new Date(item.date).toLocaleString('es')}</time></span>
          {item.undoable && <button className="button" disabled={busy} onClick={() => void undo(item.id)}>Deshacer</button>}
        </div>)}
      </details>
      {availability === 'unconfigured' && <p className="inline-warning">Gemini sin configurar. Puedes seguir usando los módulos y hacer check-ins manuales.</p>}
      {availability === 'error' && <p className="inline-warning">No se pudo comprobar Gemini. Verifica la conexión con AEGIS.</p>}
      {availability === 'checking' && <p className="muted">Comprobando Gemini…</p>}
      {configured && !messages.length && <p className="muted">Gemini configurado. Envía un mensaje para probar la conexión.</p>}
      {!messages.length && <div className="chat-intro">
        <h3>Bienvenido al Companion</h3><p>Podemos hablar un rato, revisar algo que te interese o hacer una pausa.</p>
        {prompts.map(([label, prompt]) => <button key={label} className="button" onClick={() => { setText(prompt); input.current?.focus() }}>{label}</button>)}
      </div>}
      <div className="conversation" role="log" aria-label="Conversación">
        {!greetingTranscribed && <div className="chat-message"><strong>Invitación de AEGIS</strong><p>{greeting}</p></div>}{messages.map((message, i) =>
        <div key={i} className={`chat-message ${message.role}`}><strong>{message.role === 'user' ? 'Tú' : 'AEGIS'}</strong><p>{message.text}</p></div>)}</div>
      {!!sources.length && <p className="muted">Fuentes consultadas: {sources.map(source => source.replace(/^get_/, '').replaceAll('_', ' ')).join(', ')}.</p>}
      {!!voice.transcripts.length && <div className="conversation" aria-label="Transcripción de voz">
        {voice.transcripts.slice(-6).map(item => <div className={`chat-message ${item.role}`} key={item.id}>
          <strong>{item.role === 'user' ? 'Tú · voz' : 'AEGIS · voz'}</strong><p>{item.text}</p>
        </div>)}
      </div>}
      {(pending || busy || result) && <p className="muted" role="status">{busy ? 'Guardando…' : pending ? 'Respondiendo o consultando datos…' : result}</p>}
      {error && <p className="inline-warning" role="alert">{error}</p>}
      <div ref={end}/>
    </div>

    <div className="voice-strip">
      <AudioLines size={18} className={speaking ? 'pulse' : ''}/><span role="status">{voiceLabels[voice.state]}</span>
      <button className="button" disabled={!configured || busy} onClick={speaking ? voice.stop : () => void voice.start({welcome: waitForWelcome})}>
        {speaking ? <Square size={13}/> : <Mic size={14}/>} {speaking ? 'Detener voz' : voice.state === 'error' ? 'Reconectar' : 'Iniciar voz'}
      </button>
    </div>
    {voice.state === 'suspended' && <button className="button" onClick={() => void voice.resume()}>Reanudar audio</button>}
    <details className="voice-diagnostics"><summary>Diagnóstico de audio</summary>
      <span>{voice.diagnostics.received} fragmentos PCM aceptados · {voice.diagnostics.rejected} incompatibles · {voice.diagnostics.pendingMs} ms pendientes · {voice.diagnostics.droppedMs} ms descartados · {voice.diagnostics.reconnects} reconexiones · {voice.diagnostics.interruptions} interrupciones</span>
      <span>{voice.diagnostics.rate || '—'} Hz PCM · {voice.diagnostics.played} reproducidos · {voice.diagnostics.underruns} vaciados de búfer · latencia de salida ≈ {voice.diagnostics.outputLatencyMs} ms · AudioContext: {voice.diagnostics.contextState} · WebSocket: {['conectando', 'abierto', 'cerrando', 'cerrado'][voice.diagnostics.socketState] ?? '—'}</span>
      {voice.turnStatus && <p>Sesión {voice.turnStatus.session.slice(0, 8)} · turno {voice.turnStatus.turn} · narrativa {voice.turnStatus.narrative?.slice(0, 8) ?? '—'} · {voice.turnStatus.event}</p>}
    </details>
    {voice.error && <p className="inline-warning" role="alert">{voice.error}</p>}
    <form className="chat-form" onSubmit={send}>
      <textarea ref={input} aria-label="Mensaje para AEGIS" placeholder="Escribe a AEGIS…" rows={2} maxLength={2000} value={text}
        onChange={e => setText(e.target.value)} disabled={pending}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}/>
      <button className="button primary" aria-label="Enviar mensaje" disabled={pending || busy || !text.trim() || !configured}><Send size={17}/></button>
    </form>
    <div className="companion-foot"><p>Los mensajes quedan en memoria de esta pestaña. La voz comparte audio con Gemini durante la sesión.</p>
      <button className="text-button" onClick={clear} disabled={busy}>Borrar conversación</button></div>
  </aside>
}

