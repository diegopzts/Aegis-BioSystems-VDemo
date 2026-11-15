import {useEffect, useRef} from 'react'

const vertexSource = `
attribute vec2 corner;
varying vec2 point;
void main() {
  point = corner;
  gl_Position = vec4(corner, 0.0, 1.0);
}`

const plasmaSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 point;
uniform float time;
uniform float activity;

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(
    mix(mix(hash(i),hash(i+vec3(1.,0.,0.)),f.x),
        mix(hash(i+vec3(0.,1.,0.)),hash(i+vec3(1.,1.,0.)),f.x),f.y),
    mix(mix(hash(i+vec3(0.,0.,1.)),hash(i+vec3(1.,0.,1.)),f.x),
        mix(hash(i+vec3(0.,1.,1.)),hash(i+1.),f.x),f.y),f.z);
}

void main() {
  // Radius is in viewport units. The front of the sphere supplies a curved sampling surface.
  const float radius = .70;
  float r = length(point);
  float rimDistance = r - radius;
  float angle = atan(point.y, point.x + .0001);
  float drift = time * .075;
  vec3 electric = vec3(.10,.39,1.);
  vec3 ice = vec3(.55,.90,1.);
  float azimuth = .58 + .22*sin(angle*8.+sin(angle*3.)+drift) + .10*sin(angle*19.-drift);
  float glow = exp(-max(0.,rimDistance)*(16.+8.*azimuth)) * azimuth;
  float rays = pow(max(0.,sin(angle*13.+sin(angle*6.)*2.+drift)),5.);
  float loops = (0.19+0.13*sin(angle*4.+drift)) * rays;
  float prominence = exp(-abs(rimDistance-loops)*36.) * smoothstep(.002,.036,rimDistance) * rays;
  float outside = (glow*.65 + prominence*.45) * (1.-smoothstep(.89,1.,r));
  if (r > radius+.009) {
    gl_FragColor = vec4(mix(electric,ice,min(1.,prominence*1.5)), outside*(1.+activity*.24));
    return;
  }
  vec2 xy = point / radius;
  float depth = sqrt(max(0.,1.-dot(xy,xy)));
  vec3 surface = vec3(xy,depth);
  float roll = drift * .48;
  surface.xz = mat2(cos(roll),-sin(roll),sin(roll),cos(roll))*surface.xz;
  float flow = noise(surface*5.8 + vec3(0.,drift,-drift*.32));
  vec3 domain = surface*8.9 + vec3(flow*2.8,-flow*2.1,flow) + vec3(drift*.16,0.,drift);
  float clouds = noise(domain)*.60 + noise(domain*2.2)*.28 + noise(domain*4.9)*.12;
  float filaments = pow(1.-abs(sin((clouds+.12*flow)*12.)),4.);
  float cells = noise(domain*7.4+clouds);
  float light = max(0., dot(normalize(vec3(-.28,.39,1.)),vec3(xy,depth)));
  float energy = clamp((clouds-.21)*1.16 + .14*filaments + .10*cells,0.,1.);
  vec3 color = mix(vec3(.025,.07,.42),electric,smoothstep(.10,.63,energy));
  color = mix(color,ice,smoothstep(.45,.77,energy));
  color = mix(color,vec3(.95,.99,1.),smoothstep(.70,.96,energy)*.8);
  color *= .54 + .52*sqrt(light);
  color += ice*(.29*exp(-abs(rimDistance)*82.) + .08*activity);
  float edge = 1.-smoothstep(radius-.004,radius+.009,r);
  gl_FragColor = vec4(mix(electric,min(color,1.),edge),max(edge,outside));
}`

function createStar(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: false, antialias: false, depth: false, powerPreference: 'low-power',
  })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const dispose = () => {
    for (const shader of shaders) gl.deleteShader(shader)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
  }
  if (!program || !buffer) { dispose(); return null }
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, plasmaSource]] as const) {
    const shader = gl.createShader(type)
    if (!shader) { dispose(); return null }
    shaders.push(shader)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.bindAttribLocation(program, 0, 'corner')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { dispose(); return null }
  for (const shader of shaders.splice(0)) {
    gl.detachShader(program, shader)
    gl.deleteShader(shader)
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const clock = gl.getUniformLocation(program, 'time')
  const intensity = gl.getUniformLocation(program, 'activity')
  return {
    draw(seconds: number, voice: number) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform1f(clock, seconds)
      gl.uniform1f(intensity, voice)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose,
  }
}

export function BlueStar({activity}: {activity: number}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const energy = useRef(activity)
  energy.current = activity
  useEffect(() => {
    const canvas = canvasRef.current!
    const frame = canvas.parentElement!
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let engine: ReturnType<typeof createStar> = null
    let animation = 0
    let previous = 0
    let seconds = 0
    let limit = 384
    let slowFrames = 0
    function size() {
      const pixels = Math.max(32, Math.min(limit, Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 1.25))))
      if (canvas.width !== pixels || canvas.height !== pixels) canvas.width = canvas.height = pixels
    }
    function draw(now: number) {
      animation = 0
      if (!engine || document.hidden || reduced?.matches) return
      const elapsed = previous ? now - previous : 34
      if (elapsed >= 32) {
        previous = now
        seconds += Math.min(100, elapsed) / 1000
        slowFrames = elapsed > 68 ? slowFrames + 1 : 0
        if (slowFrames === 7 && limit > 256) { limit = 256; size() }
        engine.draw(seconds, energy.current)
      }
      animation = requestAnimationFrame(draw)
    }
    function synchronize() {
      cancelAnimationFrame(animation)
      animation = 0
      previous = 0
      if (!engine || document.hidden) return
      size()
      engine.draw(seconds, reduced?.matches ? 0 : energy.current)
      if (!reduced?.matches) animation = requestAnimationFrame(draw)
    }
    function setup() {
      try { engine = createStar(canvas) } catch { engine = null }
      frame.dataset.renderer = engine ? 'webgl' : 'fallback'
      synchronize()
    }
    function contextLost(event: Event) {
      event.preventDefault()
      cancelAnimationFrame(animation)
      animation = 0
      engine = null
      frame.dataset.renderer = 'fallback'
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(synchronize) : null
    observer?.observe(canvas)
    document.addEventListener('visibilitychange', synchronize)
    reduced?.addEventListener?.('change', synchronize)
    canvas.addEventListener('webglcontextlost', contextLost)
    canvas.addEventListener('webglcontextrestored', setup)
    setup()
    return () => {
      cancelAnimationFrame(animation)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', synchronize)
      reduced?.removeEventListener?.('change', synchronize)
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', setup)
      engine?.dispose()
    }
  }, [])
  return <span className="stellar-star voice-orb" role="img" aria-label="Blue star" data-renderer="fallback">
    <canvas ref={canvasRef} aria-hidden="true"/>
  </span>
}
