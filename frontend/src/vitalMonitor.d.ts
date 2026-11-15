export interface MonitorFrame {
  epoch: number
  mode: 'simulation' | 'paused' | 'usb'
  sample: {
    profile: 'normal' | 'stemi' | 'fv' | 'paro' | 'custom'
    ecgBpm: number
    spo2: number
    sto2: number
    rso2: number
    radiationProfile: 'saludable' | 'ligero' | 'preocupante' | 'peligro'
    h2o2: number
    o2: number
    onoo: number
    no: number
    gsh: number
    mda: number
  } | null
}
export function mountVitalMonitor(root: ShadowRoot, onSample: (sample: MonitorFrame) => void): () => void
