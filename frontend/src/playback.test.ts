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

const chunk = (duration: number, length = duration * 24000) =>
  ({duration, length, numberOfChannels: 1} as AudioBuffer)

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
    expect(queue.push(chunk(.04))).toBe(true)
    expect(queue.push(chunk(.04))).toBe(true)
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

  it('rejects new audio at the memory ceiling without replacing audio waiting to play', () => {
    const {queue, context, nodes} = audioContext()
    context.state = 'suspended'
    expect(queue.push(chunk(.04, 32 * 1024 * 1024 / 4))).toBe(true)
    expect(queue.push(chunk(.08))).toBe(false)
    queue.pump()
    expect(nodes).toHaveLength(0)
    expect(queue.diagnostics.pendingMs).toBe(40)
    expect(queue.diagnostics.droppedMs).toBe(80)
    context.state = 'running'
    queue.pump()
    expect(nodes[0].start.mock.calls[0][2]).toBeCloseTo(.04)
    expect(queue.push(chunk(.04))).toBe(false)
    nodes[0].onended?.()
    expect(queue.push(chunk(.04))).toBe(true)
    queue.pump()
    queue.clear()
    expect(queue.diagnostics.pendingMs).toBe(0)
    expect(queue.diagnostics.chunks).toBe(0)
    expect(nodes[0].stop).not.toHaveBeenCalled()
    expect(nodes[1].stop).toHaveBeenCalledOnce()
  })
})

