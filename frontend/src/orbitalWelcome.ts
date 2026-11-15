import { useEffect, useRef, useState } from 'react'

export const welcomeText = 'WELCOME TO AEGIS'
const welcomeAudio = '/aegis-welcome.wav'
type Status = 'idle' | 'speaking' | 'done' | 'blocked' | 'text'

const preferredEnglishVoices = [
  /\b(?:aria|jenny|ava|emma|natasha|sonia|libby)\b.*\b(?:online|natural|neural)\b|\b(?:online|natural|neural)\b.*\b(?:aria|jenny|ava|emma|natasha|sonia|libby)\b/i,
  /\b(?:samantha|karen|moira|fiona|serena|tessa)\b.*\b(?:premium|enhanced)\b/i,
  /^(?:Google US English|Google UK English Female)$/i,
  /\b(?:aria|jenny|ava|emma|natasha|sonia|libby|samantha|karen|moira|fiona|serena|tessa|zira|hazel|female)\b/i,
]

function welcomeVoice(voices: SpeechSynthesisVoice[]) {
  const english = voices.filter(voice => /^en(?:[-_]|$)/i.test(voice.lang))
  for (const pattern of preferredEnglishVoices) {
    const matching = english.filter(voice => pattern.test(voice.name))
    const voice = matching.find(candidate => /^en[-_]us$/i.test(candidate.lang)) ?? matching[0]
    if (voice) return voice
  }
  return null
}

export function useOrbitalWelcome() {
  const [status, setStatus] = useState<Status>('idle')
  const current = useRef<Status>('idle')
  const pending = useRef<Promise<void> | undefined>(undefined)
  const cancel = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    window.speechSynthesis?.getVoices?.()
    return () => cancel.current?.()
  }, [])

  function play(retry = false): Promise<void> {
    if (pending.current) return pending.current
    if (current.current !== 'idle' && !(retry && current.current === 'blocked')) return Promise.resolve()
    current.current = 'speaking'
    setStatus('speaking')
    let resolve!: () => void
    let dispose = (_stop: boolean) => {}
    let triedFallback = false
    const spoken = new Promise<void>(done => { resolve = done })
    pending.current = spoken
    const timer = window.setTimeout(() => finish('blocked', true), 8000)

    function finish(result: Status, stop = false, update = true) {
      if (pending.current !== spoken) return
      window.clearTimeout(timer)
      pending.current = undefined
      cancel.current = undefined
      dispose(stop)
      current.current = result
      if (update) setStatus(result)
      resolve()
    }

    function synthesize() {
      if (pending.current !== spoken || triedFallback) return
      triedFallback = true
      dispose(true)
      dispose = () => {}
      const synth = window.speechSynthesis
      if (!synth || typeof SpeechSynthesisUtterance !== 'function') {
        finish('text')
        return
      }
      try {
        const utterance = new SpeechSynthesisUtterance('Welcome to Aegis.')
        const voice = welcomeVoice(synth.getVoices?.() ?? [])
        utterance.voice = voice
        utterance.lang = voice?.lang ?? 'en-US'
        utterance.rate = .95
        utterance.pitch = 1.04
        dispose = stop => {
          utterance.onend = utterance.onerror = null
          if (stop) synth.cancel()
        }
        utterance.onend = () => finish('done')
        utterance.onerror = () => finish('blocked')
        synth.speak(utterance)
      } catch { finish('blocked') }
    }

    cancel.current = () => finish('idle', true, false)
    try {
      const clip = new Audio(welcomeAudio)
      dispose = stop => {
        clip.onended = clip.onerror = null
        if (stop) clip.pause()
      }
      clip.onended = () => finish('done')
      clip.onerror = synthesize
      void clip.play().catch(synthesize)
    } catch { synthesize() }
    return spoken
  }

  return {status, play, wait: () => pending.current ?? Promise.resolve()}
}
