import type { OrbitalTelemetry } from './simulation'

export function OrbitalMonitor({orbital, day, plannedDays}: {orbital?: OrbitalTelemetry; day?: number; plannedDays?: number}) {
  const progress = day !== undefined && plannedDays && plannedDays > 0
    ? Math.round(Math.min(1, Math.max(0, day / plannedDays)) * 100) : undefined
  return <section className="orbital-monitor" aria-label="Monitor Tierra–Marte" data-link={orbital?.link_status}>
    <div className="orbital-route">
      <span className="planet earth" aria-hidden="true"/>
      <span className="orbital-line"><i aria-hidden="true"/>
        {progress !== undefined && <svg className="orbital-ship" style={{left: `${progress}%`}}
          viewBox="0 0 32 24" role="img" aria-label={`AEGIS-1, ${progress}% de trayectoria simulada${orbital?.autonomous_override ? ', nodo autónomo simulado, respuesta terrestre no disponible en tiempo real' : ''}`}>
          <path className="ship-trail" d="M2 12h10M5 9h4M5 15h4"/>
          <path className="ship-frame" d="m9 12 11-4 2-5h3l-1 5 6 4-6 4 1 5h-3l-2-5Z"/>
          <circle cx="23" cy="12" r="2"/>
        </svg>}
      </span>
      <span className="planet mars" aria-hidden="true"/>
    </div>
    <div className="orbital-data">
      <strong>Tierra–Marte</strong><small>AEGIS-1 · Telemetría sintética</small>
      {orbital ? <span>{orbital.distance_million_km.toLocaleString('es')} millones km · {orbital.one_way_label} ida</span>
        : <span>Telemetría no disponible</span>}
    </div>
    {orbital && <div className="orbital-status">
      <strong>{orbital.link_label}</strong>
      {orbital.autonomous_override && <span title="Automatización simulada dentro de AEGIS">AEGIS AUTONOMOUS OVERRIDE <small>· Simulado</small></span>}
    </div>}
  </section>
}

