/// <reference types="vite/client" />
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import type {View} from './contracts'
import {zoneAt, zones, type Zone} from './anatomyPractice'

export const anatomyAsset = import.meta.env.BASE_URL + 'biosystems/cuerpo.glb'
export type Layer = 'muscle' | 'support' | 'organs'
export type ModelState = {status: 'loading' | 'ready' | 'error'; layers: Layer[]; detail?: string}
type AnatomyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
type Part = {mesh: AnatomyMesh; layer: Layer}
const materials = (mesh: AnatomyMesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]
const isMesh = (obj: THREE.Object3D): obj is AnatomyMesh => (obj as AnatomyMesh).isMesh === true
const angles: Record<View, number> = {front: 0, left: -Math.PI / 2, right: Math.PI / 2, back: Math.PI}
// Preserve the reference layer filters. Bone names also occur in muscle and tendon names.
function layerOf(name: string): Layer {
  if (/bone|skelet|hueso|skull|rib|spine|vertebr|femur|tibia|pelvi|cranium|humerus|radius|ulna|clavicle|scapula|fibula|patella|sternum|sacrum|coccyx|mandible|carpal|tarsal|phalan|metacarp|metatars|calcane|talus/i.test(name)) return 'support'
  if (/heart|lung|brain|liver|stomach|kidney|organ|intest|spleen|pancreas/i.test(name)) return 'organs'
  return 'muscle'
}
function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse(obj => {
    if (isMesh(obj)) {
      geometries.add(obj.geometry)
      for (const material of materials(obj)) mats.add(material)
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) (obj as THREE.SkinnedMesh).skeleton.dispose()
    }
  })
  for (const material of mats) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value)
    material.dispose()
  }
  geometries.forEach(geometry => geometry.dispose())
  const images = new Set<ImageBitmap>()
  textures.forEach(texture => {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) images.add(texture.image)
    texture.dispose()
  })
  images.forEach(bitmap => bitmap.close())
}

export function mountAnatomy(canvas: HTMLCanvasElement, report: (state: ModelState) => void, select: (zone: Zone) => void) {
  const host = canvas.parentElement!
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true})
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  // Match the source camera; resize updates the aspect ratio without stretching the model.
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 100)
  camera.position.set(0, 2.3, 9)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 2, 0)
  controls.enableDamping = true
  controls.enablePan = false
  controls.minDistance = 1.6
  controls.maxDistance = 14
  controls.autoRotateSpeed = .8
  controls.autoRotate = !reduced.matches
  controls.update()
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x08142b, 11, 26)
  scene.add(new THREE.HemisphereLight(0xffe4d6, 0x1a2748, 1.1))
  const key = new THREE.DirectionalLight(0xfff1e4, 2.4), rim = new THREE.DirectionalLight(0x4aa8ff, 2)
  key.position.set(3, 5, 5); rim.position.set(-4, 3, -5)
  const grid = new THREE.GridHelper(24, 48, 0x1d5cb5, 0x12305e)
  grid.material.transparent = true
  grid.material.opacity = .55
  scene.add(key, rim, grid)
  const uniforms = {uSel: {value: 0}, uCols: {value: zones.map(() => new THREE.Color())}}
  function patch(material: THREE.Material) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = 'varying vec3 vWp;\n' + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvWp=(modelMatrix*vec4(transformed,1.)).xyz;')
      shader.fragmentShader = 'varying vec3 vWp;uniform int uSel;uniform vec3 uCols[5];\n' +
        shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float hh=vWp.y/4.,aa=abs(vWp.x)/4.;
        int rr=hh>.86?0:(aa>.16&&hh>.42&&hh<.84)?3:hh>.66?1:hh>.5?2:4;
        if(((uSel>>rr)&1)==1)totalEmissiveRadiance+=uCols[rr]*.35;`)
    }
    material.customProgramCacheKey = () => 'biosystems-region-highlight'
    material.needsUpdate = true
  }

  let model: THREE.Group | undefined, parts: Part[] = [], pickable: AnatomyMesh[] = []
  let available: Layer[] = [], mode: Layer = 'muscle', frame = 0, lastTime = 0
  let disposed = false, lost = false, loading: AbortController | undefined
  let goal: {target: THREE.Vector3; distance: number; angle?: number; elevation?: number; frames: number} | undefined
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), offset = new THREE.Vector3()
  const spherical = new THREE.Spherical()
  const original = new Map<THREE.Material, {opacity: number; transparent: boolean; depthWrite: boolean}>()
  function request() {
    if (!frame && !disposed && !lost) frame = requestAnimationFrame(render)
  }
  function render(time: number) {
    frame = 0
    if (goal) {
      offset.copy(camera.position).sub(controls.target)
      spherical.setFromVector3(offset)
      const smooth = reduced.matches ? 1 : .08
      spherical.radius += (goal.distance - spherical.radius) * (reduced.matches ? 1 : .07)
      if (goal.angle !== undefined) {
        const diff = goal.angle - spherical.theta
        spherical.theta += Math.atan2(Math.sin(diff), Math.cos(diff)) * smooth
      }
      if (goal.elevation !== undefined) spherical.phi += (goal.elevation - spherical.phi) * smooth
      if (--goal.frames <= 0 || reduced.matches) {
        controls.target.copy(goal.target)
        spherical.radius = goal.distance
        if (goal.angle !== undefined) spherical.theta = goal.angle
        if (goal.elevation !== undefined) spherical.phi = goal.elevation
        goal = undefined
      } else controls.target.lerp(goal.target, smooth)
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical))
    }
    const moved = controls.update(lastTime ? Math.min((time - lastTime) / 1000, .05) : 1 / 60)
    renderer.render(scene, camera)
    lastTime = time
    if (goal || controls.autoRotate || moved) request()
  }
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight
    if (!w || !h) return
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    request()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  function setLayer(next: Layer) {
    if (!available.includes(next)) return
    mode = next
    pickable = []
    for (const {mesh, layer} of parts) {
      const opacity = mode === 'organs' ? layer === 'muscle' ? .1 : layer === 'support' ? .4 : 1 : 1
      mesh.visible = mode === 'organs' || (mode === 'support' ? layer !== 'muscle' : layer === 'muscle')
      for (const mat of materials(mesh)) {
        const base = original.get(mat)!
        const transparent = base.transparent || opacity < 1
        if (mat.transparent !== transparent) mat.needsUpdate = true
        mat.transparent = transparent
        mat.opacity = base.opacity * opacity
        mat.depthWrite = base.depthWrite && opacity > .9
      }
      if (mesh.visible && opacity > .5) pickable.push(mesh)
    }
    request()
  }
  function install(root: THREE.Group) {
    const box = new THREE.Box3().setFromObject(root)
    const height = box.getSize(new THREE.Vector3()).y
    if (!Number.isFinite(height) || height <= 0) throw Error('Empty model')
    root.scale.setScalar(4 / height)
    root.updateMatrixWorld(true)
    box.setFromObject(root)
    const center = box.getCenter(new THREE.Vector3())
    root.position.set(-center.x, -box.min.y, -center.z)
    const next: Part[] = []
    const assigned = new Map<THREE.Material, Map<Layer, THREE.Material>>()
    root.traverse(obj => {
      if (!isMesh(obj)) return
      const layer = layerOf(obj.name + ' ' + materials(obj).map(mat => mat.name).join(' '))
      const assign = (source: THREE.Material) => {
        let variants = assigned.get(source)
        if (!variants) { variants = new Map(); assigned.set(source, variants) }
        let mat = variants.get(layer)
        if (!mat) {
          mat = variants.size ? source.clone() : source
          patch(mat)
          variants.set(layer, mat)
        }
        return mat
      }
      obj.material = Array.isArray(obj.material) ? obj.material.map(assign) : assign(obj.material)
      next.push({mesh: obj, layer})
    })
    if (!next.length) throw Error('No geometry')
    if (model) { scene.remove(model); disposeModel(model) }
    original.clear()
    parts = next
    available = [...new Set(parts.map(part => part.layer))]
    for (const {mesh} of parts) for (const mat of materials(mesh)) {
      original.set(mat, {opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite})
    }
    model = root
    scene.add(root)
    setLayer(available.includes('muscle') ? 'muscle' : available[0])
  }
  async function load(file?: File) {
    loading?.abort()
    const operation = new AbortController()
    loading = operation
    report({status: 'loading', layers: available})
    let parsed: THREE.Group | undefined
    try {
      const source = file ? await file.arrayBuffer() : await fetch(anatomyAsset, {signal: operation.signal}).then(response => {
        if (!response.ok) throw Error('Could not load model')
        return response.arrayBuffer()
      })
      if (operation.signal.aborted) return
      // User imports are local and self-contained. Never resolve remote dependencies from a supplied glTF.
      const manager = new THREE.LoadingManager()
      manager.setURLModifier(url => {
        if (!/^(data|blob):/.test(url)) throw Error('External model resource')
        return url
      })
      const gltf = await new GLTFLoader(manager).parseAsync(source, '')
      parsed = gltf.scene
      if (operation.signal.aborted) return
      install(parsed)
      parsed = undefined
      report(lost ? {status: 'error', layers: available, detail: 'WebGL context lost.'} : {status: 'ready', layers: available})
    } catch {
      if (!operation.signal.aborted) report({
        status: model ? 'ready' : 'error', layers: available,
        detail: file ? 'Could not open the model. Use a self-contained GLB or glTF.' : 'Could not load the anatomy model.',
      })
    } finally {
      if (parsed) disposeModel(parsed)
    }
  }
  let down: {id: number; x: number; y: number} | undefined
  let dragged = false
  function onDown(event: PointerEvent) {
    if (down) { dragged = true; return }
    down = {id: event.pointerId, x: event.clientX, y: event.clientY}
    dragged = false
  }
  function onMove(event: PointerEvent) {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) >= 5) dragged = true
  }
  function onCancel() { down = undefined }
  function onUp(event: PointerEvent) {
    if (down?.id !== event.pointerId) return
    onMove(event)
    down = undefined
    if (dragged || !pickable.length) return
    const rect = canvas.getBoundingClientRect()
    pointer.set(2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height)
    raycaster.setFromCamera(pointer, camera)
    const intersection = raycaster.intersectObjects(pickable, false)[0]
    if (intersection) select(zoneAt(intersection.point.x, intersection.point.y))
  }
  function onLost(event: Event) {
    event.preventDefault()
    lost = true
    cancelAnimationFrame(frame); frame = 0
    report({status: 'error', layers: available, detail: 'WebGL context lost.'})
  }
  function onRestored() {
    lost = false
    if (model) report({status: 'ready', layers: available}); else void load()
    request()
  }
  function stopFocus() { goal = undefined }
  const onMotion = () => { if (reduced.matches) controls.autoRotate = false; request() }
  controls.addEventListener('change', request)
  controls.addEventListener('start', stopFocus)
  reduced.addEventListener('change', onMotion)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onCancel)
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  canvas.dataset.orientation = 'front'
  void load()
  return {
    load, setLayer,
    focus(point: number[], view?: View) {
      const [x, y, z, distance] = point
      if (view) canvas.dataset.orientation = view
      goal = {target: new THREE.Vector3(x, y, z), distance, angle: view ? angles[view] : undefined,
        elevation: view ? Math.PI / 2 - Math.atan2(.3, 9) : undefined, frames: 59}
      controls.autoRotate = false
      request()
    },
    highlight(mask: number, colors: number[]) {
      uniforms.uSel.value = mask
      colors.forEach((color, i) => uniforms.uCols.value[i].setHex(color))
      request()
    },
    zoom(factor: number) {
      stopFocus()
      offset.copy(camera.position).sub(controls.target)
      offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance))
      camera.position.copy(controls.target).add(offset)
      request()
    },
    rotate(enabled: boolean) { stopFocus(); controls.autoRotate = enabled; request() },
    dispose() {
      disposed = true
      loading?.abort()
      cancelAnimationFrame(frame)
      observer.disconnect()
      reduced.removeEventListener('change', onMotion)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      controls.removeEventListener('change', request)
      controls.removeEventListener('start', stopFocus)
      controls.dispose()
      if (model) disposeModel(model)
      grid.geometry.dispose()
      grid.material.dispose()
      renderer.dispose()
    },
  }
}
