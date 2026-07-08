/**
 * Web Worker that paints the block-diagram wall sections. paintSectionBody is
 * DOM-free (pure canvas 2D + typed arrays), so the expensive repaints — the
 * facies split costs ~40 ms per strike wall on large datasets — run entirely
 * off the main thread; playback and camera interaction never block on them.
 * Painted walls return as transferable ImageBitmaps (flipped for three.js).
 */

import type { Section } from '../../strat/core'
import { paintSectionBody, SectionTheme } from '../sectionPaint'
import type { Frame } from '../frame'

export interface WallInit {
  n: number
  nt: number
  x: Float64Array
  topo: Float32Array
  subsid: Float32Array | null
  deformation: 'snapshot' | 'final-datum'
  /** per-point pen-up mask (plateau wedges), or null */
  skip: Uint8Array | null
  texW: number
  texH: number
}

export interface InitMsg {
  type: 'init'
  walls: WallInit[]
  yLo: number
  yHi: number
  seaLevel: Float64Array | null
  layerFacies: Int8Array | null
}

export interface PaintMsg {
  type: 'paint'
  seq: number
  wallIds: number[]
  k: number
  colorMode: 'age' | 'facies'
  bins: number[]
  keySurfaceIndices?: number[]
  theme: SectionTheme
}

export interface PaintedMsg {
  seq: number
  wallId: number
  bitmap: ImageBitmap
}

interface WorkerWall {
  sec: Section
  skip: Uint8Array | null
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
  frame: Frame
}

let walls: WorkerWall[] = []
let seaLevel: Float64Array | null = null
let layerFacies: Int8Array | null = null

self.onmessage = (e: MessageEvent<InitMsg | PaintMsg>) => {
  const msg = e.data
  if (msg.type === 'init') {
    seaLevel = msg.seaLevel
    layerFacies = msg.layerFacies
    walls = msg.walls.map((w) => {
      const canvas = new OffscreenCanvas(w.texW, w.texH)
      return {
        sec: {
          n: w.n,
          nt: w.nt,
          x: w.x,
          topo: w.topo,
          subsid: w.subsid,
          deformation: w.deformation,
          // classification is not used by the painter
          cls: new Int8Array(0),
        },
        skip: w.skip,
        canvas,
        ctx: canvas.getContext('2d')!,
        frame: {
          x0: 0,
          y0: 0,
          w: w.texW,
          h: w.texH,
          xMin: w.x[0],
          xMax: w.x[w.n - 1],
          yMin: msg.yLo,
          yMax: msg.yHi,
        },
      }
    })
    return
  }

  for (const id of msg.wallIds) {
    const w = walls[id]
    if (!w) continue
    w.ctx.clearRect(0, 0, w.canvas.width, w.canvas.height)
    paintSectionBody(
      w.ctx as unknown as CanvasRenderingContext2D,
      w.frame,
      w.sec,
      Math.min(msg.k, w.sec.nt - 1),
      msg.theme,
      {
        seaLevel,
        layerFacies,
        colorMode: msg.colorMode,
        bins: msg.bins,
        keySurfaceIndices: msg.keySurfaceIndices,
        showErosion: false,
        erosionRes: 0,
        drawWater: true,
        skipMask: w.skip ?? undefined,
        // the GPU minifies these textures on screen — hairline surfaces
        // average away, so draw them heavier and more opaque than the 2D panel
        lineScale: 2.5,
        lineAlpha: 0.8,
      },
    )
    // orientation/premultiply are handled by the receiving CanvasTexture
    const bitmap = w.canvas.transferToImageBitmap()
    const out: PaintedMsg = { seq: msg.seq, wallId: id, bitmap }
    ;(self as unknown as Worker).postMessage(out, [bitmap])
  }
}
