import { useEffect, useRef, useState } from 'react'
import albedoUrl from './assets/albedo.png'
import depthUrl from './assets/depth.png'
import normalUrl from './assets/normal.png'
import ormUrl from './assets/orm.png'
import './App.css'

type ShaderSettings = {
  ambient: number
  diffuse: number
  radius: number
  lightHeight: number
  specular: number
  depthStrength: number
  parallax: number
  exposure: number
  normalY: number
}

const DEFAULT_SETTINGS: ShaderSettings = {
  ambient: 0.46,
  diffuse: 1.2,
  radius: 0.54,
  lightHeight: 0.38,
  specular: 0.18,
  depthStrength: 0.14,
  parallax: 0,
  exposure: 1,
  normalY: 1,
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vScreenUv;

void main() {
  vScreenUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uAlbedo;
uniform sampler2D uNormal;
uniform sampler2D uDepth;
uniform sampler2D uOrm;
uniform vec2 uResolution;
uniform vec2 uImageSize;
uniform vec2 uPointer;
uniform float uAmbient;
uniform float uDiffuse;
uniform float uRadius;
uniform float uLightHeight;
uniform float uSpecular;
uniform float uDepthStrength;
uniform float uParallax;
uniform float uExposure;
uniform float uNormalY;

in vec2 vScreenUv;
out vec4 outColor;

vec2 containUv(vec2 screenUv) {
  float canvasAspect = uResolution.x / uResolution.y;
  float imageAspect = uImageSize.x / uImageSize.y;
  vec2 scale = vec2(1.0);

  if (canvasAspect > imageAspect) {
    scale.x = canvasAspect / imageAspect;
  } else {
    scale.y = imageAspect / canvasAspect;
  }

  return (screenUv - 0.5) * scale + 0.5;
}

float luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = containUv(vScreenUv);
  vec2 lightUv = containUv(uPointer);

  float depth = luminance(texture(uDepth, uv).rgb);
  vec2 parallaxOffset = (uv - lightUv) * (depth - 0.5) * uParallax;
  vec2 shadedUv = clamp(uv + parallaxOffset, vec2(0.001), vec2(0.999));

  vec3 albedo = texture(uAlbedo, shadedUv).rgb;
  vec3 normalSample = texture(uNormal, shadedUv).rgb * 2.0 - 1.0;
  vec3 normal = normalize(vec3(normalSample.x, normalSample.y * uNormalY, max(0.08, normalSample.z)));

  vec3 orm = texture(uOrm, shadedUv).rgb;
  float ao = mix(0.72, 1.08, orm.r);
  float roughness = clamp(orm.g, 0.12, 0.95);
  float height = luminance(texture(uDepth, shadedUv).rgb) * uDepthStrength;

  vec3 surface = vec3(shadedUv, height);
  vec3 light = vec3(lightUv, uLightHeight + uDepthStrength);
  vec3 lightVector = light - surface;
  float distanceToLight = length(lightVector.xy);
  vec3 lightDirection = normalize(lightVector);

  float attenuation = exp(-(distanceToLight * distanceToLight) / max(0.001, uRadius * uRadius));
  float diffuse = max(dot(normal, lightDirection), 0.0) * uDiffuse * attenuation;

  vec3 viewDirection = vec3(0.0, 0.0, 1.0);
  vec3 halfVector = normalize(lightDirection + viewDirection);
  float specularPower = mix(72.0, 12.0, roughness);
  float specular = pow(max(dot(normal, halfVector), 0.0), specularPower)
    * (1.0 - roughness)
    * uSpecular
    * attenuation;

  vec3 lightColor = vec3(1.0, 0.9, 0.74);
  vec3 color = albedo * (uAmbient + diffuse * ao * lightColor) + specular * lightColor;
  color = vec3(1.0) - exp(-color * uExposure);
  outColor = vec4(color, 1.0);
}
`

const SETTINGS_STORAGE_KEY = 'fam-lightbox-shader-settings-v2'

function readStoredSettings() {
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    return stored
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) as Partial<ShaderSettings> }
      : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)

  if (!shader) {
    throw new Error('Unable to create shader')
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error'
    gl.deleteShader(shader)
    throw new Error(message)
  }

  return shader
}

function createProgram(gl: WebGL2RenderingContext) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()

  if (!program) {
    throw new Error('Unable to create WebGL program')
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown shader link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }

  return program
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Unable to load ${src}`))
    image.src = src
  })
}

function createTexture(gl: WebGL2RenderingContext, image: HTMLImageElement) {
  const texture = gl.createTexture()

  if (!texture) {
    throw new Error('Unable to create texture')
  }

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)

  return texture
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const settingsRef = useRef(DEFAULT_SETTINGS)
  const pointerRef = useRef({ x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 })
  const [settings, setSettings] = useState(readStoredSettings)
  const [error, setError] = useState('')

  useEffect(() => {
    settingsRef.current = settings

    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Rendering should not depend on storage access.
    }
  }, [settings])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return undefined
    }

    let disposed = false
    let animationFrame = 0
    let cleanup = () => {}

    const start = async () => {
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        premultipliedAlpha: false,
      })

      if (!gl) {
        setError('WebGL2 is not available')
        return
      }

      try {
        const [albedo, normal, depth, orm] = await Promise.all([
          loadImage(albedoUrl),
          loadImage(normalUrl),
          loadImage(depthUrl),
          loadImage(ormUrl),
        ])

        if (disposed) {
          return
        }

        const program = createProgram(gl)
        const quad = gl.createBuffer()

        if (!quad) {
          throw new Error('Unable to create quad buffer')
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, quad)
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        )

        const positionLocation = gl.getAttribLocation(program, 'aPosition')
        gl.enableVertexAttribArray(positionLocation)
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

        const textures = [albedo, normal, depth, orm].map((image) => createTexture(gl, image))
        const textureUniforms = ['uAlbedo', 'uNormal', 'uDepth', 'uOrm']

        gl.useProgram(program)
        textureUniforms.forEach((name, index) => {
          const uniform = gl.getUniformLocation(program, name)
          gl.uniform1i(uniform, index)
        })

        const uniforms = {
          resolution: gl.getUniformLocation(program, 'uResolution'),
          imageSize: gl.getUniformLocation(program, 'uImageSize'),
          pointer: gl.getUniformLocation(program, 'uPointer'),
          ambient: gl.getUniformLocation(program, 'uAmbient'),
          diffuse: gl.getUniformLocation(program, 'uDiffuse'),
          radius: gl.getUniformLocation(program, 'uRadius'),
          lightHeight: gl.getUniformLocation(program, 'uLightHeight'),
          specular: gl.getUniformLocation(program, 'uSpecular'),
          depthStrength: gl.getUniformLocation(program, 'uDepthStrength'),
          parallax: gl.getUniformLocation(program, 'uParallax'),
          exposure: gl.getUniformLocation(program, 'uExposure'),
          normalY: gl.getUniformLocation(program, 'uNormalY'),
        }

        const resize = () => {
          const dpr = Math.min(window.devicePixelRatio || 1, 2)
          const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
          const height = Math.max(1, Math.round(canvas.clientHeight * dpr))

          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
          }

          gl.viewport(0, 0, width, height)
        }

        const updatePointer = (event: PointerEvent) => {
          const rect = canvas.getBoundingClientRect()
          pointerRef.current.targetX = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
          pointerRef.current.targetY = 1 - Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
        }

        const render = () => {
          resize()

          const pointer = pointerRef.current
          pointer.x += (pointer.targetX - pointer.x) * 0.16
          pointer.y += (pointer.targetY - pointer.y) * 0.16

          gl.useProgram(program)
          textures.forEach((texture, index) => {
            gl.activeTexture(gl.TEXTURE0 + index)
            gl.bindTexture(gl.TEXTURE_2D, texture)
          })

          const current = settingsRef.current
          gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
          gl.uniform2f(uniforms.imageSize, albedo.width, albedo.height)
          gl.uniform2f(uniforms.pointer, pointer.x, pointer.y)
          gl.uniform1f(uniforms.ambient, current.ambient)
          gl.uniform1f(uniforms.diffuse, current.diffuse)
          gl.uniform1f(uniforms.radius, current.radius)
          gl.uniform1f(uniforms.lightHeight, current.lightHeight)
          gl.uniform1f(uniforms.specular, current.specular)
          gl.uniform1f(uniforms.depthStrength, current.depthStrength)
          gl.uniform1f(uniforms.parallax, current.parallax)
          gl.uniform1f(uniforms.exposure, current.exposure)
          gl.uniform1f(uniforms.normalY, current.normalY)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
          animationFrame = window.requestAnimationFrame(render)
        }

        canvas.addEventListener('pointermove', updatePointer)
        cleanup = () => {
          canvas.removeEventListener('pointermove', updatePointer)
          window.cancelAnimationFrame(animationFrame)
          textures.forEach((texture) => gl.deleteTexture(texture))
          gl.deleteBuffer(quad)
          gl.deleteProgram(program)
        }

        render()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to initialize WebGL')
      }
    }

    void start()

    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  const updateSetting = (key: keyof ShaderSettings, value: number) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  return (
    <main className="lightbox">
      <section className="polaroid" aria-label="Family lightbox print">
        <div className="polaroid__photo">
          <canvas
            ref={canvasRef}
            className={`lightbox__canvas${error ? ' lightbox__canvas--hidden' : ''}`}
            aria-label="Family lightbox"
          />
          {error ? (
            <img className="lightbox__fallback" src={albedoUrl} alt="" />
          ) : null}
        </div>
        <div className="polaroid__caption" aria-hidden="true" />
      </section>
      {error ? <p className="lightbox__status">{error}</p> : null}

      <aside className="shader-panel" aria-label="Shader controls">
        <label>
          Ambient
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings.ambient}
            onChange={(event) => updateSetting('ambient', Number(event.target.value))}
          />
        </label>
        <label>
          Diffuse
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={settings.diffuse}
            onChange={(event) => updateSetting('diffuse', Number(event.target.value))}
          />
        </label>
        <label>
          Radius
          <input
            type="range"
            min="0.12"
            max="1.2"
            step="0.01"
            value={settings.radius}
            onChange={(event) => updateSetting('radius', Number(event.target.value))}
          />
        </label>
        <label>
          Height
          <input
            type="range"
            min="0.08"
            max="0.9"
            step="0.01"
            value={settings.lightHeight}
            onChange={(event) => updateSetting('lightHeight', Number(event.target.value))}
          />
        </label>
        <label>
          Specular
          <input
            type="range"
            min="0"
            max="0.8"
            step="0.01"
            value={settings.specular}
            onChange={(event) => updateSetting('specular', Number(event.target.value))}
          />
        </label>
        <label>
          Depth
          <input
            type="range"
            min="0"
            max="0.4"
            step="0.01"
            value={settings.depthStrength}
            onChange={(event) => updateSetting('depthStrength', Number(event.target.value))}
          />
        </label>
        <label>
          Parallax
          <input
            type="range"
            min="0"
            max="0.04"
            step="0.001"
            value={settings.parallax}
            onChange={(event) => updateSetting('parallax', Number(event.target.value))}
          />
        </label>
        <label>
          Exposure
          <input
            type="range"
            min="0.5"
            max="1.6"
            step="0.01"
            value={settings.exposure}
            onChange={(event) => updateSetting('exposure', Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="shader-panel__button"
          onClick={() => updateSetting('normalY', settings.normalY * -1)}
        >
          Flip Y
        </button>
      </aside>
    </main>
  )
}

export default App
