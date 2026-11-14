const LEAD = 0.025
const LOOKAHEAD = 0.18
const MAX_SOURCES = 128
const MAX_BUFFER_BYTES = 32 * 1024 * 1024
const MAX_BUFFER_COUNT = 8192
type Chunk = {buffer: AudioBuffer; offset: number; bytes: number; references: number}

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

  constructor(private context: AudioContext, private onSchedule?: (buffer: AudioBuffer, start: number, offset: number, duration: number) => void) {}

  get diagnostics() {
    return {pendingMs: Math.round((this.queued + Math.max(0, this.cursor - this.context.currentTime)) * 1000),
      chunks: this.chunks.length + this.sources.size, droppedMs: Math.round(this.dropped * 1000)}
  }

  push(buffer: AudioBuffer) {
    const bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
    if (this.bufferedBytes + bytes > MAX_BUFFER_BYTES || this.bufferCount >= MAX_BUFFER_COUNT) {
      this.dropped += buffer.duration
      return false
    }
    this.bufferedBytes += bytes
    this.bufferCount++
    this.chunks.push({buffer, offset: 0, bytes, references: 1})
    this.queued += buffer.duration
    return true
  }

  private releaseChunk(chunk: Chunk) {
    if (--chunk.references === 0) {
      this.bufferCount--
      this.bufferedBytes -= chunk.bytes
    }
  }

  pump() {
    if (this.context.state !== 'running') return
    const now = this.context.currentTime
    while (this.chunks.length && this.cursor < now + LOOKAHEAD && this.sources.size < MAX_SOURCES) {
      const chunk = this.chunks[0]
      const start = this.cursor <= now ? now + LEAD : this.cursor
      const remaining = chunk.buffer.duration - chunk.offset
      const duration = Math.min(remaining, now + LOOKAHEAD - start)
      if (duration <= 0) return
      const source = this.context.createBufferSource()
      source.buffer = chunk.buffer
      source.connect(this.context.destination)
      source.onended = () => {
        if (this.sources.delete(source)) this.releaseChunk(chunk)
        source.disconnect()
      }
      source.start(start, chunk.offset, duration)
      chunk.references++
      this.sources.add(source)
      this.onSchedule?.(chunk.buffer, start, chunk.offset, duration)
      this.cursor = start + duration
      this.queued = Math.max(0, this.queued - duration)
      chunk.offset += duration
      if (duration >= remaining) {
        this.chunks.shift()
        this.releaseChunk(chunk)
      }
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
  }
}

