export const zones = ['cabeza', 'pecho', 'abdomen', 'brazos', 'piernas'] as const
export type Zone = typeof zones[number]
type Tone = 'verde' | 'amarillo' | 'rojo'
export const habitats = {nave: 'Spacecraft in transit', estacion: 'Space station', luna: 'Lunar base', marte: 'Mars surface'}
export type Habitat = keyof typeof habitats
const offsets: Record<Habitat, number> = {nave: 0, estacion: -10, luna: 12, marte: 25}
export const zoneLabels: Record<Zone, string> = {cabeza: 'Head', pecho: 'Chest', abdomen: 'Abdomen', brazos: 'Arms', piernas: 'Legs'}

// Original AstroSalud focus positions and fictional practice data, independent of the AEGIS mission.
export const COL={verde:0x2ee59d,amarillo:0xffc83d,rojo:0xff4d6d}
export const CSS={verde:'#2ee59d',amarillo:'#ffc83d',rojo:'#ff4d6d'}
export const LBL={verde:'Normal',amarillo:'Caution',rojo:'Alert'};
export function practiceData(stress: number, habitat: Habitat) {
const eff = () => Math.max(0, Math.min(100, stress + offsets[habitat]))
const R={
 cabeza:{n:'Head',lbl:'Heart rate variability (HRV)',u:'ms',val:()=>Math.round(68-.5*eff()),st:(v: number): Tone=>v>=55?'verde':v>=42?'amarillo':'rojo',base:'Your baseline: 65 ms',hist:[66,64,67,63,60,58],f:[0,3.6,0,2.4],
  why:'HRV measures how the time between heartbeats varies.',
  esp:'Isolation, confinement, and workload can affect sleep and mood.',
  alarma:'In this exercise, review a sustained drop alongside sleep and mood.',
  tips:['Try five minutes of guided breathing.','Keep your sleep schedule.','Contact flight psychology support if the trend continues.']},
 pecho:{n:'Chest',lbl:'Resting heart rate',u:'bpm',val:()=>Math.round(62+.35*eff()),st:(v: number): Tone=>v<=78?'verde':v<=90?'amarillo':'rojo',base:'Your baseline: 62 bpm · SpO₂ normal: 95 to 100%',hist:[62,63,61,64,66,68],f:[0,2.7,0,3.2],
  why:'Resting pulse shows heart rate while at rest. Compare the simulated values with the baseline.',
  esp:'Fluid distribution shifts in microgravity, and the heart adapts.',
  alarma:'Review a sustained increase in the simulated trend.',
  tips:['Complete your aerobic exercise session.','Stay hydrated.','Repeat the training measurement after 10 minutes of rest.']},
 abdomen:{n:'Abdomen and nutrition',lbl:'Fasting blood glucose',u:'mg/dL',val:()=>Math.round(90+.2*eff()),st:(v: number): Tone=>v<=100?'verde':v<=125?'amarillo':'rojo',base:'Training range 70 to 100 mg/dL',hist:[94,96,97,95,98,97],f:[0,2.15,0,3.2],
  why:'Glucose reflects how the body processes food. Nutrition supports muscle, bone, and immune function.',
  esp:'Limited food options, stress, and activity levels can affect glucose during a mission.',
  alarma:'Review the trend if the simulated value rises above the training range.',
  tips:['Space meals throughout the day.','Limit sugary foods.','Repeat the training measurement tomorrow.']},
 brazos:{n:'Arms and muscles',lbl:'Weekly strength sessions',u:'of 4',val:()=>2,st:(v: number): Tone=>v>=3?'verde':v>=2?'amarillo':'rojo',base:'Weekly goal of 4 sessions',hist:[4,3,3,3,2,2],f:[.85,2.1,0,3.6],
  why:'Muscles support posture and movement. Reduced loading can weaken them.',
  esp:'In microgravity, muscles carry less load. Exercise helps maintain strength.',
  alarma:'Review missed sessions and changes in strength.',
  tips:['Complete any outstanding strength sessions.','Include adequate protein.','Stretch after exercise.']},
 piernas:{n:'Legs and bones',lbl:'Mechanical loading today',u:'min',val:()=>14,st:(v: number): Tone=>v>=45?'verde':v>=25?'amarillo':'rojo',base:'Daily goal of 60 minutes of resistance exercise',hist:[48,40,35,28,22,14],f:[0,.95,0,4.8],
  why:'Mechanical loading supports bone density, just as exercise supports muscle strength.',
  esp:'Weight-bearing bones lose some of their normal loading in microgravity.',
  alarma:'Review your training plan after several missed resistance sessions.',
  tips:['Use the Advanced Resistive Exercise Device (ARED).','Meet your daily exercise goal.','Include calcium and vitamin D in your nutrition plan.']}
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