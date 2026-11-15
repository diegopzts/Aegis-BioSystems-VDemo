// @vitest-environment jsdom
import {act, renderHook} from '@testing-library/react'
import {afterEach, expect, it, vi} from 'vitest'
import {useOrbitalWelcome} from './orbitalWelcome'

afterEach(() => vi.unstubAllGlobals())

it('plays the shared welcome clip only once and waits for its end', async () => {
  const clips: Clip[] = []
  class Clip {
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    play = vi.fn().mockResolvedValue(undefined)
    pause = vi.fn()
    constructor(readonly src: string) { clips.push(this) }
  }
  vi.stubGlobal('Audio', Clip)
  const {result} = renderHook(useOrbitalWelcome)
  const finished = vi.fn()
  act(() => {
    const playback = result.current.play()
    expect(result.current.play()).toBe(playback)
    expect(result.current.wait()).toBe(playback)
    void playback.then(finished)
  })
  expect(clips[0].src).toBe('/aegis-welcome.wav')
  expect(clips[0].play).toHaveBeenCalledOnce()
  expect(finished).not.toHaveBeenCalled()
  await act(async () => { clips[0].onended?.() })
  expect(finished).toHaveBeenCalledOnce()
  expect(result.current.status).toBe('done')
  await result.current.play()
  expect(clips).toHaveLength(1)
})
