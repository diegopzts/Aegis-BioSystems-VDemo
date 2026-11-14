type Segment = {buffer: AudioBuffer; start: number; offset: number; duration: number}

export class OutputMeter {
  private segments: Segment[] = []

  schedule(buffer: AudioBuffer, start: number, offset: number, duration: number) {
    this.segments.push({buffer, start, offset, duration})
  }

  clear() {
    this.segments.length = 0
  }

  playing(time: number) {
    const active = this.segments[0]
    return !!active && active.start <= time && time < active.start + active.duration
  }

  read(time: number) {
    while (this.segments.length && this.segments[0].start + this.segments[0].duration <= time) this.segments.shift()
    const active = this.segments[0]
    if (!active || time < active.start) return 0
    const samples = active.buffer.getChannelData(0)
    const rate = active.buffer.sampleRate
    const from = Math.floor((active.offset + time - active.start) * rate)
    const to = Math.min(samples.length, Math.floor((active.offset + active.duration) * rate), from + Math.ceil(rate * .02))
    if (to <= from) return 0
    let sum = 0
    for (let i = from; i < to; i++) sum += samples[i] ** 2
    return Math.sqrt(sum / (to - from))
  }
}

export function isQuietPlaybackEcho(frame: ArrayBuffer, referenceRms: number) {
  if (referenceRms < .02 || frame.byteLength < 2) return false
  const samples = new DataView(frame)
  let sum = 0
  let count = 0
  for (let i = 0; i + 1 < samples.byteLength; i += 8) {
    sum += (samples.getInt16(i, true) / 32768) ** 2
    count++
  }
  // AEC is the first line of defence. Preserve clear or uncorrelated user speech.
  return Math.sqrt(sum / count) < Math.min(.018, referenceRms * .16)
}

