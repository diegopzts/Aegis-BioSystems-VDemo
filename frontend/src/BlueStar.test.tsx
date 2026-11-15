// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {BlueStar} from './BlueStar'

afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()})

function mockGraphics(reduced = false) {
  const media = new EventTarget()
  vi.stubGlobal('matchMedia', () => Object.assign(media, {matches: reduced}))
  const frames = new Map<number, FrameRequestCallback>()
  let request = 0
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {frames.set(++request, fn); return request})
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const gl = {createProgram: vi.fn(() => ({})), createBuffer: vi.fn(() => ({})), createShader: vi.fn(() => ({})),
    getProgramParameter: vi.fn(() => true), getUniformLocation: vi.fn(() => ({})),
    shaderSource: vi.fn(), compileShader: vi.fn(), attachShader: vi.fn(), bindAttribLocation: vi.fn(), linkProgram: vi.fn(),
    detachShader: vi.fn(), deleteShader: vi.fn(), useProgram: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), viewport: vi.fn(), uniform1f: vi.fn(),
    drawArrays: vi.fn(), deleteProgram: vi.fn(), deleteBuffer: vi.fn()}
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  return {gl, frames, tick: (time: number) => {const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time))}}
}

it('draws with a bounded buffer, pauses when hidden, and releases graphics on exit', () => {
  const {gl, frames, tick} = mockGraphics()
  const {unmount} = render(<BlueStar activity={.2}/>)
  const star = screen.getByRole('img', {name: 'Blue star'})
  expect(star.getAttribute('data-renderer')).toBe('webgl')
  expect(gl.viewport).toHaveBeenCalledWith(0, 0, 384, 384)
  tick(34)
  expect(gl.drawArrays).toHaveBeenCalledTimes(2)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  expect(frames.size).toBe(0)
  unmount()
  expect(gl.deleteProgram).toHaveBeenCalledOnce()
  expect(gl.deleteBuffer).toHaveBeenCalledOnce()
})

it('draws a static reduced motion frame and falls back if the WebGL context is lost', () => {
  const {gl, frames} = mockGraphics(true)
  render(<BlueStar activity={0}/>)
  const star = screen.getByRole('img', {name: 'Blue star'})
  expect(gl.drawArrays).toHaveBeenCalledOnce()
  expect(frames.size).toBe(0)
  fireEvent(star.querySelector('canvas')!, new Event('webglcontextlost', {cancelable: true}))
  expect(star.getAttribute('data-renderer')).toBe('fallback')
  fireEvent(star.querySelector('canvas')!, new Event('webglcontextrestored'))
  expect(star.getAttribute('data-renderer')).toBe('webgl')
  expect(frames.size).toBe(0)
})

it('provides a visible fallback without a WebGL context', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  render(<BlueStar activity={0}/>)
  expect(screen.getByRole('img', {name: 'Blue star'}).getAttribute('data-renderer')).toBe('fallback')
})
