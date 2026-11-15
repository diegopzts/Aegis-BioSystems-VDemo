/// <reference types="vite/client" />
import {useEffect, useRef} from 'react'
import template from './vitalMonitor.html?raw'
import {mountVitalMonitor, type MonitorFrame} from './vitalMonitor.js'

export function LiveVitalsMonitor() {
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!element.current) return
    const root = element.current.shadowRoot ?? element.current.attachShadow({mode: 'open'})
    // A bundled, static template. Serial inputs and remote values never become markup.
    root.innerHTML = template
    const status = root.getElementById('monitor-sync')!
    const tab = crypto.randomUUID()
    const controller = new AbortController()
    let sending = false
    let pending: MonitorFrame | undefined
    let epoch = 0
    function queue(frame: MonitorFrame) {
      epoch = frame.epoch
      pending = frame
      if (!sending) void sendLatest()
    }
    async function sendLatest() {
      const frame = pending
      if (!frame || controller.signal.aborted) return
      pending = undefined
      sending = true
      try {
        const response = await fetch('/api/live-vitals', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({tab, ...frame}), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
        })
        if (!response.ok) throw Error('Monitor feed unavailable')
        if (status.dataset.sync === 'error') {
          delete status.dataset.sync
          status.textContent = ''
        }
      } catch {
        if (!controller.signal.aborted) {
          status.dataset.sync = 'error'
          status.textContent = 'The Companion cannot read the monitor. The signal is still available here.'
        }
      } finally {
        sending = false
        if (pending && !controller.signal.aborted) void sendLatest()
      }
    }
    const dispose = mountVitalMonitor(root, queue)
    return () => {
      dispose()
      controller.abort()
      // A closed marker prevents an in-flight heartbeat from reviving a departed monitor.
      void fetch('/api/live-vitals', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tab, epoch, mode: 'closed', sample: null}), keepalive: true,
      }).catch(() => {})
      root.replaceChildren()
    }
  }, [])
  return <div aria-label="Live biomedical monitor" ref={element}/>
}
