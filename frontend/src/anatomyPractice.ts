export const zones = ['cabeza', 'pecho', 'abdomen', 'brazos', 'piernas'] as const
export type Zone = typeof zones[number]
type Tone = 'verde' | 'amarillo' | 'rojo'
export const habitats = {nave: 'Nave en tránsito', estacion: 'Estación espacial', luna: 'Base lunar', marte: 'Superficie de Marte'}
export type Habitat = keyof typeof habitats
const offsets: Record<Habitat, number> = {nave: 0, estacion: -10, luna: 12, marte: 25}
export const zoneLabels: Record<Zone, string> = {cabeza: 'Cabeza', pecho: 'Pecho', abdomen: 'Abdomen', brazos: 'Brazos', piernas: 'Piernas'}

// Original AstroSalud focus positions and fictional practice data, independent of the AEGIS mission.
export const COL={verde:0x2ee59d,amarillo:0xffc83d,rojo:0xff4d6d}
export const CSS={verde:'#2ee59d',amarillo:'#ffc83d',rojo:'#ff4d6d'}
export const LBL={verde:'Normal',amarillo:'Cuidado',rojo:'Alerta'};
export function practiceData(stress: number, habitat: Habitat) {
const eff = () => Math.max(0, Math.min(100, stress + offsets[habitat]))
const R={
 cabeza:{n:'Cabeza',lbl:'Variabilidad cardíaca (HRV)',u:'ms',val:()=>Math.round(68-.5*eff()),st:(v: number): Tone=>v>=55?'verde':v>=42?'amarillo':'rojo',base:'Tu línea base: 65 ms',hist:[66,64,67,63,60,58],f:[0,3.6,0,2.4],
  why:'La HRV mide cuánto varía el tiempo entre un latido y otro. Alta indica un cuerpo relajado; baja indica un cuerpo en alerta, es decir, estrés.',
  esp:'El aislamiento, el encierro y la carga de trabajo mantienen al cuerpo en alerta y alteran el sueño y el ánimo.',
  alarma:'Cuando la HRV baja varios días seguidos, sobre todo si duermes mal o tu ánimo empeora.',
  tips:['Haz 5 minutos de respiración guiada.','Respeta tus horas de sueño.','Habla con el psicólogo de vuelo si la tendencia continúa.']},
 pecho:{n:'Pecho',lbl:'Frecuencia cardíaca en reposo',u:'lpm',val:()=>Math.round(62+.35*eff()),st:(v: number): Tone=>v<=78?'verde':v<=90?'amarillo':'rojo',base:'Tu línea base: 62 lpm · SpO₂ normal: 95 a 100 %',hist:[62,63,61,64,66,68],f:[0,2.7,0,3.2],
  why:'El pulso en reposo muestra cuánto esfuerzo hace tu corazón. Si sube frente a tu normal, puede haber estrés, deshidratación o fatiga.',
  esp:'Sin gravedad la sangre se reparte distinto y el corazón se adapta. La radiación y la falta de ejercicio elevan el riesgo cardiovascular.',
  alarma:'Si el pulso en reposo supera tu base de forma sostenida, o hay mareo, dolor en el pecho o falta de aire.',
  tips:['Haz tu sesión de ejercicio aeróbico.','Hidrátate.','Repite la medición tras 10 minutos de reposo.']},
 abdomen:{n:'Abdomen y nutrición',lbl:'Azúcar en sangre (ayunas)',u:'mg/dL',val:()=>Math.round(90+.2*eff()),st:(v: number): Tone=>v<=100?'verde':v<=125?'amarillo':'rojo',base:'Rango normal: 70 a 100 mg/dL',hist:[94,96,97,95,98,97],f:[0,2.15,0,3.2],
  why:'La glucosa muestra cómo procesa tu cuerpo la comida. Una nutrición pobre debilita huesos, músculos y defensas.',
  esp:'La comida de misión es limitada, y el estrés y la poca actividad alteran cómo el cuerpo maneja el azúcar.',
  alarma:'Si supera 125 mg/dL en ayunas, o hay sed excesiva y mucho cansancio.',
  tips:['Reparte tus comidas durante el día.','Modera los alimentos azucarados.','Mide en ayunas mañana.']},
 brazos:{n:'Brazos y músculos',lbl:'Sesiones de fuerza (semana)',u:'de 4',val:()=>2,st:(v: number): Tone=>v>=3?'verde':v>=2?'amarillo':'rojo',base:'Meta semanal: 4 sesiones',hist:[4,3,3,3,2,2],f:[.85,2.1,0,3.6],
  why:'Los músculos que no cargan peso se atrofian rápido, y sostienen tu postura y tu movilidad.',
  esp:'En microgravedad los músculos trabajan muy poco y se debilitan en semanas si no se entrenan.',
  alarma:'Si pierdes fuerza de forma notable o saltas varias sesiones seguidas.',
  tips:['Completa las sesiones de fuerza pendientes.','Come suficiente proteína.','Estira después de entrenar.']},
 piernas:{n:'Piernas y huesos',lbl:'Carga mecánica hoy',u:'min',val:()=>14,st:(v: number): Tone=>v>=45?'verde':v>=25?'amarillo':'rojo',base:'Meta diaria: 60 min de ejercicio de resistencia',hist:[48,40,35,28,22,14],f:[0,.95,0,4.8],
  why:'Los huesos se fortalecen con la carga. Sin ella pierden densidad, igual que un músculo sin uso se debilita.',
  esp:'En microgravedad se pierde cerca de 1 % de densidad ósea al mes en los huesos que sostienen peso.',
  alarma:'Cuando pasan varios días sin ejercicio de resistencia o aparecen dolores óseos.',
  tips:['Usa el dispositivo de resistencia (ARED).','Cumple tu meta diaria de ejercicio.','Cuida calcio y vitamina D.']}
};
  return Object.fromEntries(zones.map(key => {
    const entry = R[key]
    const value = entry.val()
    return [key, {...entry, value, tone: entry.st(value)}]
  })) as Record<Zone, typeof R[Zone] & {value: number; tone: Tone}>
}
export function zoneAt(x: number, y: number): Zone {
  const height = y / 4
  return height > .86 ? 'cabeza' : Math.abs(x) / 4 > .16 && height > .42 && height < .84 ? 'brazos' :
    height > .66 ? 'pecho' : height > .5 ? 'abdomen' : 'piernas'
}