/**
 * Three.js renderer/camera/controls lifecycle for the 3D block diagram.
 * Owns the on-demand render loop: camera interaction (OrbitControls) only
 * ever triggers controls.update() + render() — geometry and textures are
 * mutated externally and flagged via requestRender(). Idle GPU cost is zero.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface SceneCtl {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  /** flag a re-render (data/theme changed); coalesced into the rAF loop */
  requestRender(): void
  /** frame the camera on a block's bounding box (initial + reset view) */
  resetCamera(box: THREE.Box3): void
  setBackground(cssColor: string): void
  dispose(): void
}

export function createScene(container: HTMLElement, onContextRestored?: () => void): SceneCtl {
  const scene = new THREE.Scene()

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  })
  // retina cap: the block diagram doesn't need a 3x backing store
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.touchAction = 'none'
  container.appendChild(renderer.domElement)

  const camera = new THREE.PerspectiveCamera(
    45,
    Math.max(0.1, container.clientWidth / Math.max(1, container.clientHeight)),
    0.1,
    100,
  )

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  // don't let the camera dive under the block
  controls.maxPolarAngle = Math.PI * 0.49

  // sky/ground fill + one angled key light for topographic relief
  const hemi = new THREE.HemisphereLight(0xffffff, 0x998877, 1.9)
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(-0.6, 1, -0.8)
  scene.add(hemi, key)

  let needsRender = true
  const requestRender = () => {
    needsRender = true
  }
  controls.addEventListener('change', requestRender)

  let raf = 0
  let disposed = false
  const tick = () => {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    // update() returns true while the camera moves (incl. damping settle)
    const moved = controls.update()
    if (moved || needsRender) {
      needsRender = false
      renderer.render(scene, camera)
    }
  }
  raf = requestAnimationFrame(tick)

  const resize = () => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    requestRender()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(container)

  const onLost = (e: Event) => e.preventDefault()
  const onRestored = () => {
    onContextRestored?.()
    requestRender()
  }
  renderer.domElement.addEventListener('webglcontextlost', onLost)
  renderer.domElement.addEventListener('webglcontextrestored', onRestored)

  const resetCamera = (box: THREE.Box3) => {
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const diag = size.length()
    camera.near = diag / 1000
    camera.far = diag * 10
    camera.updateProjectionMatrix()
    // oblique view from above the downdip-left corner
    const d = diag * 1.05
    camera.position.set(
      center.x - d * 0.5,
      center.y + d * 0.85,
      center.z + d * 0.7,
    )
    controls.target.copy(center)
    controls.update()
    requestRender()
  }

  const dispose = () => {
    disposed = true
    cancelAnimationFrame(raf)
    ro.disconnect()
    renderer.domElement.removeEventListener('webglcontextlost', onLost)
    renderer.domElement.removeEventListener('webglcontextrestored', onRestored)
    controls.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
    renderer.domElement.remove()
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    requestRender,
    resetCamera,
    setBackground: (cssColor: string) => {
      scene.background = new THREE.Color(cssColor)
      requestRender()
    },
    dispose,
  }
}
