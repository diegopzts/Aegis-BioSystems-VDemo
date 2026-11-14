import { describe, expect, it, vi } from 'vitest'
import { decodePcm, PlaybackQueue } from './playback'

function audioContext() {
  const nodes: {start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>; onended: (() => void) | null}[] = []
  const context = {
    currentTime: 10, state: 'running', destination: {},
    createBuffer: vi.fn((channels: number, length: number, rate: number) => {
      const values = new Float32Array(length)
      return {duration: length / rate, getChannelData: () => values}
    }),
    createBufferSource() {
      const node = {start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null}
      nodes.push(node)
      return node
    },
  }
  return {context, nodes, queue: new PlaybackQueue(context as unknown as AudioContext)}
}

const chunk = (duration: number) => ({duration} as AudioBuffer)

describe('streaming playback', () => {
  it('decodes little-endian signed mono PCM using the advertised rate and rejects invalid framing', () => {
    const {context} = audioContext()
    const data = Uint8Array.of(0, 128, 0, 64).buffer
    const buffer = decodePcm(data, 32000, 1, context as unknown as AudioContext)
    expect(context.createBuffer).toHaveBeenCalledWith(1, 2, 32000)
    expect([...buffer!.getChannelData(0)]).toEqual([-1, .5])
    expect(decodePcm(new ArrayBuffer(3), 32000, 1, context as unknown as AudioContext)).toBeUndefined()
    expect(decodePcm(data, 32000, 2, context as unknown as AudioContext)).toBeUndefined()
  })

  it('schedules ordinary chunks contiguously, releases finished nodes, and rebases after a gap', () => {
    const {queue, context, nodes} = audioContext()
    expect(queue.push(chunk(.04))).toBe(false)
    expect(queue.push(chunk(.04))).toBe(false)
    queue.pump()
    expect(nodes[0].start.mock.calls[0][0]).toBeCloseTo(10.025)
    expect(nodes[1].start.mock.calls[0][0]).toBeCloseTo(10.065)
    nodes.forEach(node => node.onended?.())
    expect(nodes.every(node => node.disconnect.mock.calls.length === 1)).toBe(true)
    context.currentTime = 11
    queue.push(chunk(.04))
    queue.pump()
    expect(nodes[2].start.mock.calls[0][0]).toBeCloseTo(11.025)
    expect(queue.diagnostics.droppedMs).toBe(0)
  })

  it('bounds a 14-second burst, retains recent audio, and clears on interruption while suspended', () => {
    const {queue, context, nodes} = audioContext()
    context.state = 'suspended'
    for (let i = 0; i < 350; i++) queue.push(chunk(.04))
    queue.pump()
    expect(nodes).toHaveLength(0)
    expect(queue.diagnostics.pendingMs).toBeLessThanOrEqual(1500)
    expect(queue.diagnostics.droppedMs).toBeGreaterThan(12000)
    context.state = 'running'
    queue.pump()
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.at(-1)!.start.mock.calls[0][0]).toBeLessThan(10.18)
    queue.clear()
    expect(queue.diagnostics.pendingMs).toBe(0)
    expect(queue.diagnostics.chunks).toBe(0)
    expect(nodes.every(node => node.stop.mock.calls.length === 1 && node.onended === null)).toBe(true)
  })
})

