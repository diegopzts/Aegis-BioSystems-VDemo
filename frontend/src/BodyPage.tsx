import { Component, useEffect, useRef, type ReactNode } from 'react'
import { Box, RotateCcw, UserRound } from 'lucide-react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { SectionTitle } from './components'
import { metricLabels, regionLabels, regions, views, type Metric, type Mission, type Region, type View } from './contracts'

export const cameraPositions: Record<View, [number, number, number]> = {
  front: [0, 0.2, 5.6], left: [-5.6, 0.2, 0], right: [5.6, 0.2, 0], back: [0, 0.2, -5.6],
}
export const regionMetrics: Record<Region, Metric[]> = {
  full: ['temperature', 'heartRate', 'spo2', 'sleepHours'], head: ['sleepHours'], chest: ['heartRate', 'spo2'], limbs: ['temperature'],
}

function Camera({view, revision}: {view: View; revision: number}) {
  const controls = useRef<OrbitControlsImpl>(null)
  useEffect(() => {
    if (!controls.current) return
    controls.current.object.position.set(...cameraPositions[view])
    controls.current.target.set(0, 0, 0)
    controls.current.update()
  }, [view, revision])
  return <OrbitControls ref={controls} enablePan={false} minDistance={3.4} maxDistance={9}/>
}

function BodyModel({region, select}: {region: Region; select: (region: Region) => void}) {
  function material(part: Region, visor = false) {
    const selected = part === region
    return <meshStandardMaterial color={selected ? '#5bd5f9' : visor ? '#295a82' : '#5c83ab'}
      metalness={visor ? 0.75 : 0.5} roughness={visor ? 0.22 : 0.42}
      emissive={selected ? '#177893' : '#102236'} emissiveIntensity={selected ? 0.52 : 0.2}/>
  }
  function choose(part: Region) {
    return (event: {stopPropagation: () => void}) => { event.stopPropagation(); select(part) }
  }
  return <group>
    <group position={[0, 1.13, 0]} onClick={choose('head')}>
      <mesh scale={[0.29, 0.34, 0.27]}><sphereGeometry args={[1, 32, 24]}/>{material('head')}</mesh>
      <mesh position={[0, 0.015, 0.143]} scale={[0.249, 0.18, 0.15]}><sphereGeometry args={[1, 32, 24]}/>{material('head', true)}</mesh>
    </group>
    <group onClick={choose('chest')}>
      <mesh position={[0, 0.45, 0]} scale={[0.48, 0.49, 0.235]}><sphereGeometry args={[1, 32, 24]}/>{material('chest')}</mesh>
      <mesh position={[0, 0.01, 0]} scale={[0.33, 0.26, 0.2]}><sphereGeometry args={[1, 24, 20]}/>{material('chest')}</mesh>
      <mesh position={[0, 0.42, 0.21]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.13, 0.13, 0.055]}/>{material('chest', true)}</mesh>
    </group>
    <group onClick={choose('limbs')}>
      {[-1, 1].map(side => <group key={side}>
        <mesh position={[side * 0.49, 0.51, 0]}><sphereGeometry args={[0.17, 22, 16]}/>{material('limbs')}</mesh>
        <mesh position={[side * 0.63, 0.16, 0]} rotation={[0, 0, side * 0.36]}><capsuleGeometry args={[0.105, 0.57, 7, 18]}/>{material('limbs')}</mesh>
        <mesh position={[side * 0.77, -0.25, 0.02]} scale={[0.11, 0.14, 0.09]}><sphereGeometry args={[1, 20, 16]}/>{material('limbs')}</mesh>
        <mesh position={[side * 0.185, -0.59, 0]} rotation={[0, 0, side * 0.065]}><capsuleGeometry args={[0.155, 0.67, 8, 20]}/>{material('limbs')}</mesh>
        <mesh position={[side * 0.225, -1.09, 0]}><capsuleGeometry args={[0.123, 0.34, 8, 20]}/>{material('limbs')}</mesh>
        <mesh position={[side * 0.225, -1.37, 0.06]} scale={[0.135, 0.11, 0.21]}><sphereGeometry args={[1, 20, 16]}/>{material('limbs')}</mesh>
      </group>)}
    </group>
  </group>
}

class ViewerBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false}
  static getDerivedStateFromError() { return {failed: true} }
  render() {
    return this.state.failed ? <p className="viewer-fallback">WebGL is unavailable. Region metrics remain accessible.</p> : this.props.children
  }
}

export function BodyPage({mission, region, view, revision, setRegion, setView}: {
  mission: Mission; region: Region; view: View; revision: number; setRegion: (region: Region) => void; setView: (view: View) => void
}) {
  return <div className="split-grid body-grid">
    <section className="panel content-panel">
      <SectionTitle icon={<Box size={19}/>} title="Crew Model" subtitle="Drag to rotate · Scroll to zoom"
        action={<button className="button" onClick={() => {setRegion('full'); setView('front')}}><RotateCcw size={15}/> Reset view</button>}/>
      <div className="body-canvas"><ViewerBoundary><Canvas camera={{position: cameraPositions.front, fov: 39}}
        fallback={<p className="viewer-fallback">WebGL is required for the interactive model.</p>}>
        <ambientLight intensity={1.0}/><directionalLight position={[3, 5, 4]} intensity={2.35} color="#c6ecff"/>
        <directionalLight position={[-3, 0, -4]} intensity={2.5} color="#1687d9"/>
        <Grid position={[0, -1.49, 0]} args={[8, 8]} cellSize={0.36} cellColor="#214565" sectionColor="#3c6890" fadeDistance={7}/>
        <BodyModel region={region} select={setRegion}/><Camera view={view} revision={revision}/>
      </Canvas></ViewerBoundary></div>
      <div className="control-strip viewer-controls" aria-label="Camera orientation">{views.map(value =>
        <button key={value} className="button capitalize" aria-pressed={view === value} onClick={() => setView(value)}>{value}</button>)}</div>
    </section>
    <section className="panel content-panel">
      <SectionTitle icon={<UserRound size={19}/>} title="Body Regions" subtitle="Explore related mission measurements"/>
      <div className="region-tabs">{regions.map(key => <button key={key} className="button" aria-pressed={key === region} onClick={() => setRegion(key)}>{regionLabels[key]}</button>)}</div>
      <h3>{regionLabels[region]}</h3>
      <dl className="detail-list">{regionMetrics[region].map(metric => <div key={metric}><dt>{metricLabels[metric]}</dt>
        <dd>{mission.metrics[metric].value} {mission.metrics[metric].unit}</dd></div>)}
        {region === 'head' && <div><dt>Mood</dt><dd>{mission.wellness.mood}/5</dd></div>}
      </dl>
      <p className="muted">Measurements shown are simulated and associated with regions for exploration.</p>
    </section>
  </div>
}
