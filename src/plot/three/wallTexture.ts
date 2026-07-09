/**
 * Textured walls of the 3D block diagram. Each wall is a flat quad in a
 * constant-X or constant-Z plane, draped with its 2D cross section rendered
 * by paintSectionBody — pixel-consistent with the cross-section panel (age /
 * facies-split / water all included). Painting runs in a Web Worker
 * (wallWorker.ts) so even the expensive facies repaints never block playback
 * or camera interaction; finished walls arrive as ImageBitmaps into
 * bitmaprenderer canvases (zero-copy, and CanvasTexture handles orientation
 * and premultiplied alpha — raw ImageBitmap textures render translucent
 * fills wrong).
 *
 * Exploded and cut views pass arbitrary wall lists (16 walls for 2×2, 36 for
 * 3×3), with pre-sliced sections and world offsets. Geometry is in raw data
 * units; vertical exaggeration is the caller's group.scale.y.
 */

import * as THREE from 'three'

import type { Section } from '../../strat/core'
import type { Frame } from '../frame'
import { paintSectionBody, SectionTheme } from '../sectionPaint'
import type { InitMsg, PaintedMsg, PaintMsg, WallInit } from './wallWorker'

export interface WallSpec {
  /** pre-sliced section along the wall (x in absolute grid coordinates) */
  sec: Section
  /** per-point pen-up mask (plateau wedge crossings), or undefined */
  skip?: Uint8Array
  /** which world axis is constant across the wall */
  plane: 'x' | 'z'
  /** world coordinate of the wall plane */
  planePos: number
  /** world offset of the owning (sub-)block */
  ox: number
  oz: number
  /** sign of the outward normal along the plane axis */
  outward: 1 | -1
}

export interface WallPaintOpts {
  colorMode: 'age' | 'facies'
  bins: number[]
  keySurfaceIndices?: number[]
  /** draw the erosional-surface overlay (red truncation surfaces) */
  showErosion: boolean
  /** vertical resolution threshold for the erosion overlay */
  erosionRes: number
  theme: SectionTheme
}

export interface WallsCtl {
  group: THREE.Group
  /**
   * Repaint wall textures for step k (async, in the worker). `which` limits
   * to those wall indices. With `skippable` the request is dropped while the
   * worker is still busy — playback ticks skip rather than queue up.
   * Returns false when the request was dropped (callers retry next tick).
   */
  update(k: number, opts: WallPaintOpts, which?: number[], skippable?: boolean): boolean
  dispose(): void
}

interface Wall {
  /** async mode: receives worker bitmaps zero-copy for the CanvasTexture */
  blit: ImageBitmapRenderingContext | null
  /** sync mode: painted directly on the main thread */
  ctx2d: OffscreenCanvasRenderingContext2D | null
  frame: Frame
  tex: THREE.CanvasTexture<OffscreenCanvas>
  mat: THREE.MeshBasicMaterial
  geom: THREE.BufferGeometry
}

export function buildWalls(
  specs: WallSpec[],
  opts: {
    yLo: number
    yHi: number
    seaLevel: Float64Array | null
    layerFacies: Int8Array | null
    anisotropy: number
    onPainted: () => void
  },
): WallsCtl {
  const { yLo, yHi } = opts
  // texture sizing: crisp when maximized for the plain block; exploded views
  // have many smaller walls, so scale down to bound GPU memory
  const many = specs.length > 8
  const texH = many ? 512 : 1024
  const texW = (n: number) => Math.min(many ? 2048 : 4096, Math.max(256, n * 8))

  // Without a sea level there is no facies split — every mode uses the cheap
  // layer-fill paint (~5-10 ms for four walls), so paint SYNCHRONOUSLY on
  // the main thread. This matters for meanderpy: each migration event
  // deposits a THICK layer, and even a one-step async lag behind the top
  // surface flashes as a white band during playback (on the flume datasets
  // the per-step increments are too thin to notice).
  const sync = !opts.seaLevel

  // Async mode: a small worker POOL paints walls concurrently (wall i →
  // worker i mod P): batch latency is the slowest single wall instead of the
  // sum of all four, which keeps the fill on the walls close behind the top
  // surface during playback. Each worker gets its own copies of every
  // section — the arrays may be views into the cached full topo volume
  // (transferring those would detach it), and workers don't share memory.
  const P = Math.max(1, Math.min(4, specs.length, (navigator.hardwareConcurrency || 4) - 2))
  const wallTexW = specs.map(({ sec }) => texW(sec.n))
  const workers: Worker[] = []
  for (let p = 0; p < (sync ? 0 : P); p++) {
    const worker = new Worker(new URL('./wallWorker.ts', import.meta.url), { type: 'module' })
    const wallInits: WallInit[] = specs.map(({ sec, skip }, i) => ({
      n: sec.n,
      nt: sec.nt,
      x: new Float64Array(sec.x),
      topo: new Float32Array(sec.topo),
      subsid: sec.subsid ? new Float32Array(sec.subsid) : null,
      deformation: sec.deformation,
      skip: skip ? new Uint8Array(skip) : null,
      texW: wallTexW[i],
      texH,
    }))
    const init: InitMsg = {
      type: 'init',
      walls: wallInits,
      yLo,
      yHi,
      seaLevel: opts.seaLevel ? new Float64Array(opts.seaLevel) : null,
      layerFacies: opts.layerFacies ? new Int8Array(opts.layerFacies) : null,
    }
    worker.postMessage(
      init,
      wallInits.flatMap((w) => [
        w.x.buffer,
        w.topo.buffer,
        ...(w.subsid ? [w.subsid.buffer] : []),
        ...(w.skip ? [w.skip.buffer] : []),
      ]),
    )
    workers.push(worker)
  }

  const group = new THREE.Group()

  const walls: Wall[] = specs.map((spec, i) => {
    const { sec } = spec
    const canvas = new OffscreenCanvas(wallTexW[i], texH)
    // a canvas can hold only ONE context kind: 2d for sync painting,
    // bitmaprenderer for worker bitmaps
    const ctx2d = sync ? canvas.getContext('2d')! : null
    const blit = sync ? null : canvas.getContext('bitmaprenderer')!
    const frame: Frame = {
      x0: 0,
      y0: 0,
      w: wallTexW[i],
      h: texH,
      xMin: sec.x[0],
      xMax: sec.x[sec.n - 1],
      yMin: yLo,
      yMax: yHi,
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = opts.anisotropy
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      visible: false, // until the first painted bitmap arrives
    })
    // corner order: (u0,yLo) (u1,yLo) (u1,yHi) (u0,yHi) with u along the
    // section; CanvasTexture's flipY puts canvas row 0 (yHi) at v=1
    const u0 = sec.x[0]
    const u1 = sec.x[sec.n - 1]
    const pos = new Float32Array(12)
    for (let v = 0; v < 4; v++) {
      const u = v === 1 || v === 2 ? u1 : u0
      const y = v >= 2 ? yHi : yLo
      pos[v * 3] = (spec.plane === 'z' ? u : spec.planePos) + spec.ox
      pos[v * 3 + 1] = y
      pos[v * 3 + 2] = (spec.plane === 'z' ? spec.planePos : u) + spec.oz
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
    geom.setIndex([0, 1, 2, 0, 2, 3])
    group.add(new THREE.Mesh(geom, mat))
    return { blit, ctx2d, frame, tex, mat, geom }
  })

  // Requests coalesce: while the worker is busy, only the LATEST wanted
  // repaint is remembered and sent on completion — a fast slider scrub or
  // playback burst never builds a queue of stale paints.
  let seq = 0
  const lastSent = new Array<number>(specs.length).fill(0)
  let pending = 0
  let wanted: { k: number; opts: WallPaintOpts; which?: number[] } | null = null

  const send = (k: number, o: WallPaintOpts, which?: number[]) => {
    const ids = which ?? walls.map((_, i) => i)
    seq++
    for (const i of ids) lastSent[i] = seq
    pending += ids.length
    // route each wall to its worker (wall i → worker i mod P)
    for (let p = 0; p < P; p++) {
      const wallIds = ids.filter((i) => i % P === p)
      if (!wallIds.length) continue
      const msg: PaintMsg = {
        type: 'paint',
        seq,
        wallIds,
        k,
        colorMode: o.colorMode,
        bins: o.bins,
        keySurfaceIndices: o.keySurfaceIndices,
        showErosion: o.showErosion,
        erosionRes: o.erosionRes,
        theme: o.theme,
      }
      workers[p].postMessage(msg)
    }
  }

  const onPainted = (e: MessageEvent<PaintedMsg>) => {
    const { seq: s, wallId, bitmap } = e.data
    pending = Math.max(0, pending - 1)
    if (pending === 0 && wanted) {
      const w = wanted
      wanted = null
      send(w.k, w.opts, w.which)
    }
    if (s !== lastSent[wallId]) {
      bitmap.close() // superseded while painting
      return
    }
    const w = walls[wallId]
    if (!w.blit) {
      bitmap.close() // sync mode never spawns workers; defensive
      return
    }
    w.blit.transferFromImageBitmap(bitmap)
    w.tex.needsUpdate = true
    w.mat.visible = true
    opts.onPainted()
  }
  for (const w of workers) w.onmessage = onPainted

  const update = (k: number, o: WallPaintOpts, which?: number[], skippable = false): boolean => {
    if (sync) {
      // cheap layer-fill paint: draw right now, in step with the top surface
      const ids = which ?? walls.map((_, i) => i)
      for (const i of ids) {
        const w = walls[i]
        const spec = specs[i]
        w.ctx2d!.clearRect(0, 0, w.frame.w, w.frame.h)
        paintSectionBody(
          w.ctx2d! as unknown as CanvasRenderingContext2D,
          w.frame,
          spec.sec,
          Math.min(k, spec.sec.nt - 1),
          o.theme,
          {
            seaLevel: null,
            layerFacies: opts.layerFacies,
            colorMode: o.colorMode,
            bins: o.bins,
            keySurfaceIndices: o.keySurfaceIndices,
            showErosion: o.showErosion,
            erosionRes: o.erosionRes,
            drawWater: false,
            skipMask: spec.skip,
            lineScale: 2.5,
            lineAlpha: 0.8,
          },
        )
        w.tex.needsUpdate = true
        w.mat.visible = true
      }
      opts.onPainted()
      return true
    }
    if (pending > 0) {
      // remember the newest request; playback ticks (skippable) are simply
      // dropped — the next tick will catch up
      if (!skippable) wanted = { k, opts: o, which }
      return false
    }
    send(k, o, which)
    return true
  }

  return {
    group,
    update,
    dispose: () => {
      for (const w of workers) w.terminate()
      for (const w of walls) {
        w.geom.dispose()
        w.mat.dispose()
        w.tex.dispose()
      }
    },
  }
}
