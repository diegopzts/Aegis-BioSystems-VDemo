import { Component, lazy, Suspense, useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { request } from './api'

const OrbitalExperience = lazy(() => import('./OrbitalExperience'))
const preferenceKey = 'aegis-ui'
const unavailable = 'Experiencia orbital no disponible. Se muestra la vista clásica.'
type Config = 'pending' | 'enabled' | 'disabled' | 'unavailable'

function loadClassicPreference() {
  try { return localStorage.getItem(preferenceKey) === 'classic' }
  catch { return false }
}

export function useOrbitalUi() {
  const [urlClassic] = useState(() => new URLSearchParams(window.location.search).get('aegis-ui') === 'classic')
  const [preferredClassic, setPreferredClassic] = useState(loadClassicPreference)
  const [config, setConfig] = useState<Config>('pending')
  const forceClassic = urlClassic || preferredClassic

  useEffect(() => {
    if (forceClassic) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setConfig('unavailable')
      controller.abort()
    }, 5000)
    request<{orbitalUiEnabled?: unknown}>('config', {signal: controller.signal, cache: 'no-store'})
      .then(data => {
        if (!controller.signal.aborted) {
          setConfig(data?.orbitalUiEnabled === true ? 'enabled' :
            data?.orbitalUiEnabled === false ? 'disabled' : 'unavailable')
        }
      })
      .catch(() => { if (!controller.signal.aborted) setConfig('unavailable') })
      .finally(() => window.clearTimeout(timer))
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [forceClassic])

  function setPreference(classic: boolean) {
    setConfig('pending')
    setPreferredClassic(classic)
    try {
      if (classic) localStorage.setItem(preferenceKey, 'classic')
      else localStorage.removeItem(preferenceKey)
    } catch { /* The preference still applies in the current tab. */ }
  }

  return {orbital: !forceClassic && config === 'enabled', failed: !forceClassic && config === 'unavailable',
    urlClassic, preferredClassic: forceClassic, setPreference}
}

class OrbitalBoundary extends Component<{fallback: ReactNode; children: ReactNode}, {failed: boolean}> {
  state = {failed: false}

  static getDerivedStateFromError() {
    return {failed: true}
  }

  render() {
    if (this.state.failed) return <>{this.props.fallback}<p className="orbital-notice" role="status">{unavailable}</p></>
    return this.props.children
  }
}

export function OrbitalSlot({enabled, failed, ...scene}: ComponentProps<typeof OrbitalExperience> & {
  enabled: boolean; failed: boolean
}) {
  if (!enabled) return failed ? <p className="orbital-notice" role="status">{unavailable}</p> : null

  return <OrbitalBoundary fallback={null}>
    <Suspense fallback={null}><OrbitalExperience {...scene}/></Suspense>
  </OrbitalBoundary>
}
