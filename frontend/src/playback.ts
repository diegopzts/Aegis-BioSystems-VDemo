const LEAD = 0.025
const LOOKAHEAD = 0.18
const MAX_PENDING = 1.5
const RETAIN = 0.75
const MAX_CHUNKS = 128

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
  private chunks: {buffer: AudioBuffer; offset: number}[] = []
  private sources = new Set<AudioBufferSourceNode>()
  private cursor = 0
  private queued = 0
  private dropped = 0

  constructor(private context: AudioContext, private onSchedule?: (buffer: AudioBuffer, start: number, offset: number, duration: number) => void) {}

  get diagnostics() {
    return {pendingMs: Math.round((this.queued + Math.max(0, this.cursor - this.context.currentTime)) * 1000),
      chunks: this.chunks.length + this.sources.size, droppedMs: Math.round(this.dropped * 1000)}
  }

  push(buffer: AudioBuffer) {
    this.chunks.push({buffer, offset: 0})
    this.queued += buffer.duration
    if (this.queued <= MAX_PENDING && this.chunks.length <= MAX_CHUNKS) return false
    while (this.chunks.length && (this.queued > RETAIN || this.chunks.length > MAX_CHUNKS)) {
      const oldest = this.chunks[0]
      const duration = oldest.buffer.duration - oldest.offset
      const trim = this.chunks.length > MAX_CHUNKS ? duration : Math.min(duration, this.queued - RETAIN)
      oldest.offset += trim
      this.queued -= trim
      this.dropped += trim
      if (trim >= duration) this.chunks.shift()
    }
    return true
  }

  pump() {
    if (this.context.state !== 'running') return
    const now = this.context.currentTime
    while (this.chunks.length && this.cursor < now + LOOKAHEAD && this.sources.size < MAX_CHUNKS) {
      const chunk = this.chunks[0]
      const start = this.cursor <= now ? now + LEAD : this.cursor
      const remaining = chunk.buffer.duration - chunk.offset
      const duration = Math.min(remaining, now + LOOKAHEAD - start)
      if (duration <= 0) return
      const source = this.context.createBufferSource()
      source.buffer = chunk.buffer
      source.connect(this.context.destination)
      source.onended = () => {
        this.sources.delete(source)
        source.disconnect()
      }
      source.start(start, chunk.offset, duration)
      this.onSchedule?.(chunk.buffer, start, chunk.offset, duration)
      this.sources.add(source)
      this.cursor = start + duration
      this.queued = Math.max(0, this.queued - duration)
      chunk.offset += duration
      if (duration >= remaining) this.chunks.shift()
    }
  }

  clear() {
    for (const source of this.sources) {
      source.onended = null
      source.stop()
      source.disconnect()
    }
    this.sources.clear()
    this.chunks = []
    this.queued = 0
    this.cursor = 0
  }
}

