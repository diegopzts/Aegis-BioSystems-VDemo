import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react'
import { AudioLines, Mic, Send, Sparkles, Square, X } from 'lucide-react'
import { post, request, useResource } from './api'
import { changeSchema, replySchema, type Action, type Change, type Message, type Position, type WorkspaceView } from './contracts'
import { CheckinSettings, type CheckinPromptState } from './checkinPrompt'
import { useVoice, type VoiceState } from './voice'
import { VoiceOrb } from './VoiceOrb'
import type { InputGraph, Simulation } from './simulation'

const greeting = 'How are you feeling today?'
const prompts = [
  ['Talk about how I feel', 'I would like to talk about how I feel.'],
  ['Review my sleep', 'What do my latest sleep records show?'],
  ['View wellbeing trends', 'How have my energy and stress changed over the last seven days?'],
  ['Take a short break', 'Can we do a short exercise to take a break?'],
]
const voiceLabels = {
  disconnected: 'Voice disconnected', connecting: 'Connecting…', listening: 'Listening',
  responding: 'Generating voice…', receiving: 'Receiving audio…', playing: 'Playing voice',
  suspended: 'Voice paused by the browser', error: 'Voice error',
  'text-only': 'Transcript only. Gemini sent no audio.', 'no-audio': 'Gemini finished without audio',
  'audio-error': 'Voice error. Unsupported audio format.',
}
const operations: Record<string, string> = {
  create_wellness_entry: 'Create check-in', update_wellness_entry: 'Edit check-in', delete_wellness_entry: 'Remove check-in',
  acknowledge_alert: 'Review alert', set_mission_scenario: 'Change scenario', advance_mission: 'Advance one day',
  reset_mission: 'Reset simulation', undo: 'Undo change',
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
      setError(controller.signal.aborted ? 'The request timed out.' : error instanceof Error ? error.message : 'Could not reach Gemini.')
    } finally {
      window.clearTimeout(timeout)
      if (requestController.current === controller) setPending(false)
    }
  }

  function showChange(change: Change) {
    onChange(change)
    setRevision(old => old + 1)
    const id = change.record.id
    setResult(`Saved · ${operations[change.operation] ?? 'Change applied'}${id ? ` · #${id}` : ''}`)
  }

  async function undo(id: number) {
    setBusy(true)
    setError('')
    setResult('')
    try {
      showChange(changeSchema.parse(await post<unknown>(`companion/activity/${id}/undo`, {})))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not undo the change.')
    } finally { setBusy(false) }
  }

  return <aside hidden={!visible} className="companion panel" aria-label="AEGIS AI Companion" lang="en" onKeyDown={e => { if (e.key === 'Escape') close() }}>
    <header className="companion-header"><div className="section-icon"><Sparkles size={20}/></div>
      <div><h2>AEGIS AI Companion</h2><p>Wellbeing during the mission · Google Gemini</p></div>
      <button className="icon-button" onClick={close} aria-label="Close assistant"><X size={18}/></button>
    </header>
    {visible && !orbital && <VoiceOrb graph={inputGraph} breathing={breathing} output={voice.outputLevel} state={voice.state}
      label={voiceLabels[voice.state]} alert={Boolean(simulation && simulation.scenario_id !== 'nominal')}/>}
    <div className="chat-log">
      <p className="muted">AEGIS is an educational demo with synthetic data. For mental health support, consult a qualified professional.</p>
      <p className="muted">The Companion can read AEGIS data and apply requested changes. Gemini processes messages and relevant data, including wellbeing notes when they are needed to answer.</p>
      <details className="companion-details"><summary>Check-in settings</summary><CheckinSettings prompt={checkin}/></details>
      <details className="companion-details"><summary>Local activity</summary>
        {activity.error && <button className="button" onClick={activity.retry}>Retry activity</button>}
        {!activity.data?.length && <p>No changes recorded.</p>}
        {activity.data?.map(item => <div key={item.id} className="activity-item">
          <span>{operations[item.operation] ?? item.operation} · applied<br/><time dateTime={item.date}>{new Date(item.date).toLocaleString('en-US')}</time></span>
          {item.undoable && <button className="button" disabled={busy} onClick={() => void undo(item.id)}>Undo</button>}
        </div>)}
      </details>
      {availability === 'unconfigured' && <p className="inline-warning">Gemini is not configured. Modules and manual check-ins are available.</p>}
      {availability === 'error' && <p className="inline-warning">Could not check Gemini. Verify your connection to AEGIS.</p>}
      {availability === 'checking' && <p className="muted">Checking Gemini…</p>}
      {configured && !messages.length && <p className="muted">Gemini is configured. Send a message to test the connection.</p>}
      {!messages.length && <div className="chat-intro">
        <h3>Welcome to the Companion</h3><p>Talk, review your mission data, or take a break.</p>
        {prompts.map(([label, prompt]) => <button key={label} className="button" onClick={() => { setText(prompt); input.current?.focus() }}>{label}</button>)}
      </div>}
      <div className="conversation" role="log" aria-label="Conversation">
        {!greetingTranscribed && <div className="chat-message"><strong>AEGIS check-in</strong><p>{greeting}</p></div>}{messages.map((message, i) =>
        <div key={i} className={`chat-message ${message.role}`}><strong>{message.role === 'user' ? 'You' : 'AEGIS'}</strong><p>{message.text}</p></div>)}</div>
      {!!sources.length && <p className="muted">Sources: {sources.map(source => source.replace(/^get_/, '').replaceAll('_', ' ')).join(', ')}.</p>}
      {!!voice.transcripts.length && <div className="conversation" aria-label="Voice transcript">
        {voice.transcripts.slice(-6).map(item => <div className={`chat-message ${item.role}`} key={item.id}>
          <strong>{item.role === 'user' ? 'You · voice' : 'AEGIS · voice'}</strong><p>{item.text}</p>
        </div>)}
      </div>}
      {(pending || busy || result) && <p className="muted" role="status">{busy ? 'Saving…' : pending ? 'Responding or retrieving data…' : result}</p>}
      {error && <p className="inline-warning" role="alert">{error}</p>}
      <div ref={end}/>
    </div>

    <div className="voice-strip">
      <AudioLines size={18} className={speaking ? 'pulse' : ''}/><span role="status">{voiceLabels[voice.state]}</span>
      <button className="button" disabled={!configured || busy} onClick={speaking ? voice.stop : () => void voice.start({welcome: waitForWelcome})}>
        {speaking ? <Square size={13}/> : <Mic size={14}/>} {speaking ? 'Stop voice' : voice.state === 'error' ? 'Reconnect' : 'Start voice'}
      </button>
    </div>
    {voice.state === 'suspended' && <button className="button" onClick={() => void voice.resume()}>Resume audio</button>}
    <details className="voice-diagnostics"><summary>Audio diagnostics</summary>
      <span>{voice.diagnostics.received} PCM chunks accepted · {voice.diagnostics.rejected} incompatible · {voice.diagnostics.pendingMs} ms queued · {voice.diagnostics.droppedMs} ms discarded · {voice.diagnostics.reconnects} reconnects · {voice.diagnostics.interruptions} interruptions</span>
      <span>{voice.diagnostics.rate || '—'} Hz PCM · {voice.diagnostics.played} played · {voice.diagnostics.underruns} buffer underruns · output latency ≈ {voice.diagnostics.outputLatencyMs} ms · AudioContext: {voice.diagnostics.contextState} · WebSocket: {['connecting', 'open', 'closing', 'closed'][voice.diagnostics.socketState] ?? '—'}</span>
      {voice.turnStatus && <p>Session {voice.turnStatus.session.slice(0, 8)} · turn {voice.turnStatus.turn} · narrative {voice.turnStatus.narrative?.slice(0, 8) ?? '—'} · {voice.turnStatus.event}</p>}
    </details>
    {voice.error && <p className="inline-warning" role="alert">{voice.error}</p>}
    <form className="chat-form" onSubmit={send}>
      <textarea ref={input} aria-label="Message to AEGIS" placeholder="Write to AEGIS…" rows={2} maxLength={2000} value={text}
        onChange={e => setText(e.target.value)} disabled={pending}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}/>
      <button className="button primary" aria-label="Send message" disabled={pending || busy || !text.trim() || !configured}><Send size={17}/></button>
    </form>
    <div className="companion-foot"><p>Messages stay in this tab's memory. Voice audio goes to Gemini during the session.</p>
      <button className="text-button" onClick={clear} disabled={busy}>Clear conversation</button></div>
  </aside>
}

