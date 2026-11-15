const LEAD = 0.025
const LOOKAHEAD = 0.35
const INITIAL_BUFFER = 0.12
const RECOVERY_BUFFER = 0.24
const MAX_START_WAIT = 0.3
const MAX_SOURCES = 128
const MAX_BUFFER_BYTES = 32 * 1024 * 1024
const MAX_BUFFER_COUNT = 8192
type Chunk = {buffer: AudioBuffer; bytes: number}

export function decodePcm(data: ArrayBuffer, rate: number, channels: number, context: AudioContext) {
  if (channels !== 1 || !Number.isInteger(rate) || rate < 8000 || rate > 96000 ||
      !data.byteLength || data.byteLength % 2 || data.byteLength > 384_000) return
  const view = new DataView(data)
  const buffer = context.createBuffer(channels, data.byteLength / 2, rate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
  return buffer
}

export class PlaybackQueue {
  private chunks: Chunk[] = []
  private sources = new Set<AudioBufferSourceNode>()
  private bufferCount = 0
  private bufferedBytes = 0
  private cursor = 0
  private queued = 0
  private dropped = 0
  private waitingSince: number | undefined
  private primed = false
  private finishing = false
  private rebuffering = false
  private played = 0
  private underruns = 0

  constructor(private context: AudioContext, private onSchedule?: (buffer: AudioBuffer, start: number, offset: number, duration: number) => void) {}

  get diagnostics() {
    return {pendingMs: Math.round((this.queued + Math.max(0, this.cursor - this.context.currentTime)) * 1000),
      chunks: this.chunks.length + this.sources.size, droppedMs: Math.round(this.dropped * 1000),
      played: this.played, underruns: this.underruns}
  }

  push(buffer: AudioBuffer) {
    const bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
    if (this.bufferedBytes + bytes > MAX_BUFFER_BYTES || this.bufferCount >= MAX_BUFFER_COUNT) {
      this.dropped += buffer.duration
      return false
    }
    this.bufferedBytes += bytes
    this.bufferCount++
    this.chunks.push({buffer, bytes})
    this.queued += buffer.duration
    this.finishing = false
    return true
  }

  private releaseChunk(chunk: Chunk) {
    this.bufferCount--
    this.bufferedBytes -= chunk.bytes
  }

  /** The provider is finished; release even a tail shorter than the jitter buffer. */
  finish() { this.finishing = true }

  pump() {
    if (this.context.state !== 'running') return
    const now = this.context.currentTime
    if (this.primed && this.cursor < now) {
      this.primed = false
      if (!this.finishing) {
        this.underruns++
        this.rebuffering = true
      }
    }
    if (!this.chunks.length) {
      if (!this.primed) this.finishing = false
      return
    }
    if (!this.primed) {
      this.waitingSince ??= now
      const target = this.rebuffering ? RECOVERY_BUFFER : INITIAL_BUFFER
      if (!this.finishing && this.queued + 1e-6 < target && now - this.waitingSince < MAX_START_WAIT) return
      this.waitingSince = undefined
      this.rebuffering = false
      this.primed = true
      this.cursor = now + LEAD
    }
    while (this.chunks.length && this.cursor < now + LOOKAHEAD && this.sources.size < MAX_SOURCES) {
      const chunk = this.chunks[0]
      const start = this.cursor
      const duration = chunk.buffer.duration
      const source = this.context.createBufferSource()
      source.buffer = chunk.buffer
      source.connect(this.context.destination)
      source.onended = () => {
        if (this.sources.delete(source)) {
          this.releaseChunk(chunk)
          this.played++
        }
        source.disconnect()
      }
      source.start(start, 0, duration)
      this.sources.add(source)
      this.onSchedule?.(chunk.buffer, start, 0, duration)
      this.cursor = start + duration
      this.queued = Math.max(0, this.queued - duration)
      this.chunks.shift()
    }
  }

  clear() {
    for (const source of this.sources) {
      source.onended = null
      source.stop()
      source.disconnect()
    }
    this.sources.clear()
    this.bufferCount = 0
    this.bufferedBytes = 0
    this.chunks = []
    this.queued = 0
    this.cursor = 0
    this.waitingSince = undefined
    this.primed = this.finishing = this.rebuffering = false
  }
}

