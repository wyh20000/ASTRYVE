import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const STAR_COUNT = 3500
const FIELD_HEIGHT = 12

function randomGenerator(): () => number {
  let seed = 0x6d2b79f5
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

/** A quiet star field. The renderer receives pointer coordinates, never auth data. */
export function LoginScene(): JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = host.current
    const surface = element?.closest<HTMLElement>('.login-lock')
    if (!element || !surface) return

    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' }) }
    catch { return }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
    renderer.setPixelRatio(pixelRatio)
    renderer.setClearColor(0x000000, 0)
    element.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 30)
    camera.position.z = 10
    const auroraGeometry = new THREE.PlaneGeometry(1, 1)
    const auroraMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `varying vec2 vUv;
        uniform float uTime;
        void main() {
          float t = uTime * 0.00018;
          float x = vUv.x;
          float y = vUv.y;
          float wave = 0.68 + 0.065 * sin(x * 6.0 + t)
            + 0.028 * sin(x * 13.0 - t * 0.7);
          float secondWave = 0.61 + 0.048 * sin(x * 5.3 - t * 0.8 + 1.8);
          float veil = max(wave - y, 0.0);
          float curtain = exp(-veil * 13.0) * smoothstep(-0.035, 0.02, wave - y);
          float lowerGlow = exp(-pow((y - secondWave) * 9.0, 2.0));
          float folds = 0.68 + 0.32 * pow(sin(x * 48.0 + sin(x * 8.0 + t) * 4.0), 2.0);
          float fade = smoothstep(0.02, 0.17, x) * (1.0 - smoothstep(0.84, 0.99, x));
          vec3 teal = vec3(0.16, 0.58, 0.62);
          vec3 violet = vec3(0.32, 0.35, 0.72);
          vec3 color = mix(teal, violet, smoothstep(0.35, 0.9, x));
          float alpha = (curtain * 0.4 + lowerGlow * 0.11) * folds * fade;
          gl_FragColor = vec4(color, alpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const aurora = new THREE.Mesh(auroraGeometry, auroraMaterial)
    aurora.position.z = -5
    scene.add(aurora)
    const random = randomGenerator()
    const normalized = new Float32Array(STAR_COUNT * 2)
    const base = new Float32Array(STAR_COUNT * 2)
    const velocities = new Float32Array(STAR_COUNT * 2)
    const positions = new Float32Array(STAR_COUNT * 3)
    const colors = new Float32Array(STAR_COUNT * 3)
    const sizes = new Float32Array(STAR_COUNT)
    const phases = new Float32Array(STAR_COUNT)
    const palette = [new THREE.Color('#a8c8ed'), new THREE.Color('#d6e5ff'),
      new THREE.Color('#8fb9d6'), new THREE.Color('#b7a9dd')]

    for (let i = 0; i < STAR_COUNT; i++) {
      const band = i < STAR_COUNT * 0.62
      const nx = random() * 2 - 1
      const spread = (random() + random() + random() - 1.5) * 0.3
      normalized[i * 2] = nx
      normalized[i * 2 + 1] = band ? Math.max(-1, Math.min(1, nx * 0.28 + spread)) : random() * 2 - 1
      positions[i * 3 + 2] = random() * -3
      const tint = palette[Math.floor(random() * palette.length)]
      const brightness = band ? 0.45 + random() * 0.55 : 0.15 + random() * 0.55
      colors[i * 3] = tint.r * brightness
      colors[i * 3 + 1] = tint.g * brightness
      colors[i * 3 + 2] = tint.b * brightness
      sizes[i] = random() > 0.985 ? 3.2 : 1 + random() * 1.4
      phases[i] = random() * Math.PI * 2
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
      vertexShader: `attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uTime;
        uniform float uPixelRatio;
        void main() {
          vColor = color;
          vAlpha = 0.72 + 0.28 * sin(uTime * 0.00065 + aPhase);
          gl_PointSize = aSize * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
          float alpha = 1.0 - smoothstep(0.16, 0.5, distanceFromCenter);
          gl_FragColor = vec4(vColor, alpha * vAlpha);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    scene.add(new THREE.Points(geometry, material))

    let halfWidth = 6
    const halfHeight = FIELD_HEIGHT / 2
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pointer = { x: 0, y: 0, active: false }
    const resize = (): void => {
      const { width, height } = element.getBoundingClientRect()
      if (!width || !height) return
      halfWidth = halfHeight * width / height
      camera.left = -halfWidth
      camera.right = halfWidth
      camera.top = halfHeight
      camera.bottom = -halfHeight
      camera.updateProjectionMatrix()
      aurora.scale.set(halfWidth * 2, halfHeight * 2, 1)
      renderer.setSize(width, height, false)
      for (let i = 0; i < STAR_COUNT; i++) {
        base[i * 2] = normalized[i * 2] * halfWidth
        base[i * 2 + 1] = normalized[i * 2 + 1] * halfHeight
        positions[i * 3] = base[i * 2]
        positions[i * 3 + 1] = base[i * 2 + 1]
        velocities[i * 2] = 0
        velocities[i * 2 + 1] = 0
      }
      geometry.attributes.position.needsUpdate = true
      renderer.render(scene, camera)
    }
    const onPointerMove = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width * 2 - 1) * halfWidth
      pointer.y = (1 - (event.clientY - rect.top) / rect.height * 2) * halfHeight
      pointer.active = true
    }
    const onPointerLeave = (): void => { pointer.active = false }
    surface.addEventListener('pointermove', onPointerMove)
    surface.addEventListener('pointerleave', onPointerLeave)
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()

    let lastFrame = 0
    const animate = (time: number): void => {
      if (document.hidden || time - lastFrame < 32) return
      lastFrame = time
      material.uniforms.uTime.value = time
      auroraMaterial.uniforms.uTime.value = time
      for (let i = 0; i < STAR_COUNT; i++) {
        const index = i * 2
        const positionIndex = i * 3
        const driftX = Math.sin(time * 0.00013 + phases[i]) * 0.045
        const driftY = Math.cos(time * 0.00011 + phases[i]) * 0.04
        const x = positions[positionIndex]
        const y = positions[positionIndex + 1]
        let vx = velocities[index] + (base[index] + driftX - x) * 0.015
        let vy = velocities[index + 1] + (base[index + 1] + driftY - y) * 0.015
        if (pointer.active) {
          const dx = x - pointer.x
          const dy = y - pointer.y
          const distanceSquared = dx * dx + dy * dy
          if (distanceSquared < 3.2 && distanceSquared > 0.0001) {
            const distance = Math.sqrt(distanceSquared)
            const force = (1 - distance / Math.sqrt(3.2)) ** 2 * 0.075
            vx += dx / distance * force
            vy += dy / distance * force
          }
        }
        velocities[index] = vx * 0.9
        velocities[index + 1] = vy * 0.9
        positions[positionIndex] = x + velocities[index]
        positions[positionIndex + 1] = y + velocities[index + 1]
      }
      geometry.attributes.position.needsUpdate = true
      renderer.render(scene, camera)
    }
    const updateMotion = (): void => {
      renderer.setAnimationLoop(reducedMotion.matches ? null : animate)
      if (reducedMotion.matches) renderer.render(scene, camera)
    }
    reducedMotion.addEventListener('change', updateMotion)
    updateMotion()
    return () => {
      renderer.setAnimationLoop(null)
      reducedMotion.removeEventListener('change', updateMotion)
      observer.disconnect()
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerleave', onPointerLeave)
      geometry.dispose()
      material.dispose()
      auroraGeometry.dispose()
      auroraMaterial.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={host} className="login-scene" aria-hidden="true" />
}
