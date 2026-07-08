import { ReactNode, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import type { Dataset } from '../../data/loader'
import type { NdArray } from '../../data/ndarray'
import type { SpaceGrid3d } from '../../data/types'
import { themeColors } from '../../plot/frame'
import type { GridClean } from '../../plot/three/gridClean'
import type { AnalyzeMsg } from '../../plot/three/gridCleanWorker'
import { createScene, SceneCtl } from '../../plot/three/scene'
import { buildTopoMesh, TopoDims, TopoMeshCtl } from '../../plot/three/topoMesh'
import { buildWalls, WallsCtl, WallSpec } from '../../plot/three/wallTexture'
import { gridSectionSlice, sectionBounds } from '../../strat/core'
import { useAppStore } from '../../state/store'

/**
 * 3D block diagram (grid3d datasets): the current topography as a shaded
 * heightfield, stratigraphy exposed on the side walls as draped cross
 * sections — the classic stratigraph look. View modes: single block,
 * exploded 2×2 / 3×3 (sub-blocks with gaps, interior faces exposed), and
 * dip/strike cuts that follow the shared section position (the cut face IS
 * the section shown in the cross-section panel).
 *
 * Camera interaction is GPU-only; wall painting runs in a worker; the top
 * surface updates in place every step. Spike outliers and junk edges in the
 * flume scans are filtered for display (gridClean).
 */

type ViewMode = 'block' | '2×2' | '3×3' | 'dip cut' | 'strike cut'
const VIEW_MODES: ViewMode[] = ['block', '2×2', '3×3', 'dip cut', 'strike cut']

// grid analysis takes ~1-2 s on the big volumes, so it runs in a worker (the
// UI stays live) and is cached — the panel remounts on every map↔3D toggle
const cleanCache = new Map<string, GridClean>()

function analyzeInWorker(msg: AnalyzeMsg): Promise<GridClean> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../../plot/three/gridCleanWorker.ts', import.meta.url), {
      type: 'module',
    })
    w.onmessage = (e: MessageEvent<GridClean>) => {
      w.terminate()
      resolve(e.data)
    }
    w.onerror = (e) => {
      w.terminate()
      reject(new Error(e.message))
    }
    w.postMessage(msg, [msg.data.buffer])
  })
}

interface Base {
  sceneCtl: SceneCtl
  topoV: NdArray
  subsidV: NdArray | null
  seaLevel: Float64Array | null
  layerFacies: Int8Array | null
  clean: GridClean
  dims: TopoDims
  yLo: number
  yHi: number
}

interface Blocks {
  group: THREE.Group
  topos: TopoMeshCtl[]
  walls: WallsCtl
  box: THREE.Box3
}

export function Panel3D({ dataset, leading }: { dataset: Dataset; leading?: ReactNode }) {
  const timeStep = useAppStore((s) => s.timeStep)
  const playing = useAppStore((s) => s.playing)
  const colorMode = useAppStore((s) => s.sectionColorMode)
  const setColorMode = useAppStore((s) => s.setSectionColorMode)
  const sectionAxis = useAppStore((s) => s.sectionAxis)
  const sectionIndex = useAppStore((s) => s.sectionIndex)
  const setSection = useAppStore((s) => s.setSection)
  const uiTheme = useAppStore((s) => s.theme)
  const containerRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<Base | null>(null)
  const blocksRef = useRef<Blocks | null>(null)
  const repaintRef = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false)
  const [blocksVersion, setBlocksVersion] = useState(0)
  const [mode, setMode] = useState<ViewMode>('block')
  const [ve, setVe] = useState(1)
  const [veMax, setVeMax] = useState(20)
  // gap between exploded sub-blocks, as a fraction of the block extent
  const [gap, setGap] = useState(0.1)
  // erosional-surface overlay on the wall sections (red), like the 2D panel
  const [showErosion, setShowErosion] = useState(false)
  // cut modes: show the block on the other side of the cut plane
  const [cutFlip, setCutFlip] = useState(false)

  // cut position: the shared section index when the axes match, else center
  const space = dataset.manifest.space as SpaceGrid3d
  const [nRows, nCols] = space.shape
  const cutPos =
    mode === 'dip cut'
      ? sectionAxis === 'dip'
        ? sectionIndex
        : Math.floor(nRows / 2)
      : mode === 'strike cut'
        ? sectionAxis === 'strike'
          ? sectionIndex
          : Math.floor(nCols / 2)
        : -1

  // ------------------------- dataset-level setup -------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    const sceneCtl = createScene(container, () => repaintRef.current?.())

    const m = dataset.manifest
    const sp = m.space as SpaceGrid3d
    const [nR, nC] = sp.shape
    const [dRow, dCol] = sp.spacing
    const nt = m.time.n

    void (async () => {
      const [topoV, subsidV, slV, lfV] = await Promise.all([
        dataset.array('topo'),
        m.arrays.subsid ? dataset.array('subsid') : Promise.resolve(null),
        m.arrays.seaLevel ? dataset.array('seaLevel') : Promise.resolve(null),
        m.derived?.layerFacies ? dataset.array('layerFacies') : Promise.resolve(null),
      ])
      if (cancelled) return
      let clean = cleanCache.get(m.id)
      if (!clean) {
        clean = await analyzeInWorker({
          data: new Float32Array(topoV.data as Float32Array), // transferred away
          nRows: nR,
          nCols: nC,
          nt,
          res: m.processing.resolution,
          hasSubsid: !!subsidV,
        })
        cleanCache.set(m.id, clean)
        if (cancelled) return
      }

      // shared vertical extent from sampled (despiked) sections, so every
      // view mode frames the same prism
      let lo = Infinity
      let hi = -Infinity
      const bounds = (axis: 'dip' | 'strike', index: number) => {
        const b = sectionBounds(
          axis === 'dip'
            ? gridSectionSlice(topoV, subsidV, sp, nt, 'dip', index, clean.c0, clean.c1, clean.bad)
            : gridSectionSlice(topoV, subsidV, sp, nt, 'strike', index, clean.r0, clean.r1, clean.bad),
        )
        if (b.lo < lo) lo = b.lo
        if (b.hi > hi) hi = b.hi
      }
      const rStep = Math.max(1, Math.floor((clean.r1 - clean.r0) / 8))
      const cStep = Math.max(1, Math.floor((clean.c1 - clean.c0) / 8))
      for (let r = clean.r0; r <= clean.r1; r += rStep) bounds('dip', r)
      bounds('dip', clean.r1)
      for (let c = clean.c0; c <= clean.c1; c += cStep) bounds('strike', c)
      bounds('strike', clean.c1)
      const pad = (hi - lo) * 0.02

      baseRef.current = {
        sceneCtl,
        topoV,
        subsidV,
        seaLevel: slV ? (slV.data as Float64Array) : null,
        layerFacies: lfV ? (lfV.data as Int8Array) : null,
        clean,
        dims: { nRows: nR, nCols: nC, nt, dRow, dCol },
        yLo: lo - pad,
        yHi: hi + pad,
      }
      // default vertical exaggeration: block relief ~25% of the long extent
      const LX = (clean.c1 - clean.c0) * dCol
      const LZ = (clean.r1 - clean.r0) * dRow
      const relief = hi - lo
      const ve0 = Math.min(500, Math.max(1, Math.round(((0.25 * Math.max(LX, LZ)) / relief) * 10) / 10))
      // Slider ceiling: the manifest can pin it per dataset
      // (views.block3d.veMax) — the generic PROPORTIONAL rule (2x the
      // default puts the relief at ~half the long extent) misjudges models
      // whose total relief is unrepresentative, like meanderpy's thin
      // incised channels on a flat floodplain.
      const veCap = (m.views.block3d as { veMax?: number } | undefined)?.veMax
      const veMax0 = veCap ?? Math.max(2, Math.ceil(ve0 * 2))
      setVe(Math.min(ve0, veMax0))
      setVeMax(veMax0)
      setReady(true)
    })()

    return () => {
      cancelled = true
      const blocks = blocksRef.current
      blocksRef.current = null
      baseRef.current = null
      if (blocks) {
        blocks.topos.forEach((t) => t.dispose())
        blocks.walls.dispose()
      }
      sceneCtl.dispose()
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset])

  // -------------------- (re)build the block geometry ---------------------
  const prevModeRef = useRef<ViewMode | null>(null)
  useEffect(() => {
    const b = baseRef.current
    if (!ready || !b) return
    const modeChanged = prevModeRef.current !== mode

    const build = () => {
      const { clean, dims, sceneCtl } = b
      const { dRow, dCol, nt } = dims
      const old = blocksRef.current
      if (old) {
        sceneCtl.scene.remove(old.group)
        old.topos.forEach((t) => t.dispose())
        old.walls.dispose()
      }

      // sub-block index ranges for this view mode
      const R0 = clean.r0
      const R1 = clean.r1
      const C0 = clean.c0
      const C1 = clean.c1
      const nb = mode === '2×2' ? 2 : mode === '3×3' ? 3 : 1
      const gapX = gap * (C1 - C0) * dCol
      const gapZ = gap * (R1 - R0) * dRow
      const splits = (lo0: number, hi0: number, n: number): [number, number][] => {
        const out: [number, number][] = []
        const len = hi0 - lo0 + 1
        for (let i = 0; i < n; i++) {
          const a = lo0 + Math.round((i * len) / n)
          const bnd = lo0 + Math.round(((i + 1) * len) / n) - 1
          out.push([a, Math.max(a + 1, bnd)])
        }
        return out
      }
      let blockRanges: { r0: number; r1: number; c0: number; c1: number; ox: number; oz: number }[]
      if (nb > 1) {
        blockRanges = []
        const rs = splits(R0, R1, nb)
        const cs = splits(C0, C1, nb)
        for (let i = 0; i < nb; i++) {
          for (let j = 0; j < nb; j++) {
            blockRanges.push({
              r0: rs[i][0], r1: rs[i][1], c0: cs[j][0], c1: cs[j][1],
              ox: j * gapX, oz: i * gapZ,
            })
          }
        }
      } else if (mode === 'dip cut') {
        const cut = Math.min(R1 - 1, Math.max(R0 + 1, cutPos))
        blockRanges = [
          cutFlip
            ? { r0: cut, r1: R1, c0: C0, c1: C1, ox: 0, oz: 0 }
            : { r0: R0, r1: cut, c0: C0, c1: C1, ox: 0, oz: 0 },
        ]
      } else if (mode === 'strike cut') {
        const cut = Math.min(C1 - 1, Math.max(C0 + 1, cutPos))
        blockRanges = [
          cutFlip
            ? { r0: R0, r1: R1, c0: cut, c1: C1, ox: 0, oz: 0 }
            : { r0: R0, r1: R1, c0: C0, c1: cut, ox: 0, oz: 0 },
        ]
      } else {
        blockRanges = [{ r0: R0, r1: R1, c0: C0, c1: C1, ox: 0, oz: 0 }]
      }

      const group = new THREE.Group()
      const topos: TopoMeshCtl[] = []
      const wallSpecs: WallSpec[] = []
      const sp = dataset.manifest.space as SpaceGrid3d
      for (const br of blockRanges) {
        const topo = buildTopoMesh(
          b.topoV, dims, { ...br, ox: br.ox, oz: br.oz },
          clean.bad, clean.exempt, clean.spikeThresh,
          b.subsidV ? (b.subsidV.data as Float32Array) : null,
        )
        topos.push(topo)
        group.add(topo.mesh)
        const slice = (axis: 'dip' | 'strike', index: number, lo: number, hi: number) =>
          gridSectionSlice(b.topoV, b.subsidV, sp, nt, axis, index, lo, hi, clean.bad)
        // pen-up mask where the wall crosses a plateau wedge: the painter
        // then leaves the wedge as solid basement up to the plateau level
        const wallSkip = (axis: 'dip' | 'strike', index: number, lo: number, hi: number) => {
          const m = new Uint8Array(hi - lo + 1)
          let any = false
          for (let j = 0; j < m.length; j++) {
            const cell =
              axis === 'dip' ? index * dims.nCols + (lo + j) : (lo + j) * dims.nCols + index
            if (clean.exempt[cell]) {
              m[j] = 1
              any = true
            }
          }
          return any ? m : undefined
        }
        wallSpecs.push(
          { sec: slice('dip', br.r0, br.c0, br.c1), skip: wallSkip('dip', br.r0, br.c0, br.c1), plane: 'z', planePos: br.r0 * dRow, ox: br.ox, oz: br.oz, outward: -1 },
          { sec: slice('dip', br.r1, br.c0, br.c1), skip: wallSkip('dip', br.r1, br.c0, br.c1), plane: 'z', planePos: br.r1 * dRow, ox: br.ox, oz: br.oz, outward: 1 },
          { sec: slice('strike', br.c0, br.r0, br.r1), skip: wallSkip('strike', br.c0, br.r0, br.r1), plane: 'x', planePos: br.c0 * dCol, ox: br.ox, oz: br.oz, outward: -1 },
          { sec: slice('strike', br.c1, br.r0, br.r1), skip: wallSkip('strike', br.c1, br.r0, br.r1), plane: 'x', planePos: br.c1 * dCol, ox: br.ox, oz: br.oz, outward: 1 },
        )
      }
      const walls = buildWalls(wallSpecs, {
        yLo: b.yLo,
        yHi: b.yHi,
        seaLevel: b.seaLevel,
        layerFacies: b.layerFacies,
        anisotropy: sceneCtl.renderer.capabilities.getMaxAnisotropy(),
        onPainted: () => sceneCtl.requestRender(),
      })
      group.add(walls.group)
      sceneCtl.scene.add(group)

      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (const br of blockRanges) {
        minX = Math.min(minX, br.c0 * dCol + br.ox)
        maxX = Math.max(maxX, br.c1 * dCol + br.ox)
        minZ = Math.min(minZ, br.r0 * dRow + br.oz)
        maxZ = Math.max(maxZ, br.r1 * dRow + br.oz)
      }
      blocksRef.current = {
        group,
        topos,
        walls,
        box: new THREE.Box3(new THREE.Vector3(minX, b.yLo, minZ), new THREE.Vector3(maxX, b.yHi, maxZ)),
      }
      setBlocksVersion((v) => v + 1)
      if (modeChanged) {
        prevModeRef.current = mode
        sceneCtl.resetCamera(scaledBox(blocksRef.current.box, veRef.current))
      }
    }

    if (modeChanged) {
      build()
      return
    }
    // cut position / gap size following a slider: debounce the rebuild
    const t = window.setTimeout(build, 120)
    return () => window.clearTimeout(t)
  }, [ready, mode, cutPos, cutFlip, gap, dataset])

  // ------------------------- data/theme updates --------------------------
  useEffect(() => {
    const b = baseRef.current
    const blocks = blocksRef.current
    const container = containerRef.current
    if (!ready || !b || !blocks || !container) return
    const repaint = (full: boolean) => {
      const m = dataset.manifest
      const theme = themeColors(container)
      const k = Math.min(timeStep, b.dims.nt - 1)
      const bins = (m.processing.faciesDepthBins as number[] | undefined) ?? [0, -100]
      b.sceneCtl.setBackground(theme.paper)
      const topoOpts = {
        seaLevel: b.seaLevel ? b.seaLevel[k] : null,
        paper: theme.paper,
        range: b.clean.range,
      }
      for (const t of blocks.topos) t.update(k, topoOpts)
      const wallOpts = {
        colorMode,
        bins,
        keySurfaceIndices: m.keySurfaceIndices,
        showErosion,
        erosionRes: m.processing.resolution,
        theme,
      }
      if (full) {
        blocks.walls.update(k, wallOpts)
      } else {
        // playback: request every step; the wall pool paints as fast as it
        // can (busy → the request is dropped, the next step retries), so the
        // fill on the walls trails the top surface by at most one paint
        // batch. Painting is entirely off the main thread.
        blocks.walls.update(k, wallOpts, undefined, true)
      }
      b.sceneCtl.requestRender()
    }
    // one microtask later: App's effect writes data-theme on <html> AFTER
    // child effects run, and themeColors must read the flipped CSS variables
    let stale = false
    queueMicrotask(() => {
      if (!stale) repaint(!playing)
    })
    repaintRef.current = () => repaint(true)
    return () => {
      stale = true
    }
  }, [ready, blocksVersion, timeStep, colorMode, showErosion, uiTheme, playing, dataset])

  // vertical exaggeration: a group scale — no geometry or texture rebuilds
  const veRef = useRef(ve)
  veRef.current = ve
  useEffect(() => {
    const blocks = blocksRef.current
    const b = baseRef.current
    if (!ready || !blocks || !b) return
    blocks.group.scale.set(1, ve, 1)
    b.sceneCtl.requestRender()
  }, [ready, blocksVersion, ve])

  const hasFacies =
    dataset.manifest.kind === 'grid3d' &&
    (!!dataset.manifest.arrays.seaLevel || !!dataset.manifest.derived?.layerFacies)

  const pickMode = (vm: ViewMode) => {
    setMode(vm)
    // align the shared section with the cut so the cross-section panel and
    // map trace show the face being cut
    if (vm === 'dip cut' && sectionAxis !== 'dip') setSection('dip', Math.floor(nRows / 2))
    if (vm === 'strike cut' && sectionAxis !== 'strike') setSection('strike', Math.floor(nCols / 2))
  }

  return (
    <div className="panel__body">
      <div className="controls-row">
        {leading}
        <div className="seg">
          {VIEW_MODES.map((vm) => (
            <button
              key={vm}
              className={`seg__btn${vm === mode ? ' is-active' : ''}`}
              onClick={() => pickMode(vm)}
              title={
                vm === 'dip cut' || vm === 'strike cut'
                  ? 'cut the block at the shared section position'
                  : vm === 'block'
                    ? 'single block'
                    : 'exploded view'
              }
            >
              {vm}
            </button>
          ))}
        </div>
        {(mode === 'dip cut' || mode === 'strike cut') && (
          <>
            <span className="controls-row__label">cut</span>
            <input
              type="range"
              className="mini-slider"
              style={{ flex: '0 1 110px' }}
              min={0}
              max={(mode === 'dip cut' ? nRows : nCols) - 1}
              value={cutPos}
              onChange={(e) =>
                // drives the SHARED section, so the map trace and the
                // cross-section panel follow the cut face
                setSection(mode === 'dip cut' ? 'dip' : 'strike', Number(e.target.value))
              }
              aria-label="cut position"
            />
            <button
              className={`seg__btn seg__btn--solo${cutFlip ? ' is-active' : ''}`}
              onClick={() => setCutFlip((v) => !v)}
              title="show the block on the other side of the cut plane"
            >
              other side
            </button>
          </>
        )}
        {(mode === '2×2' || mode === '3×3') && (
          <>
            <span className="controls-row__label">gap</span>
            <input
              type="range"
              className="mini-slider"
              style={{ flex: '0 1 110px' }}
              min={0}
              max={0.4}
              step={0.02}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              aria-label="gap between blocks"
            />
          </>
        )}
        {hasFacies && (
          <div className="seg">
            {(['age', 'facies'] as const).map((cm) => (
              <button
                key={cm}
                className={`seg__btn${cm === colorMode ? ' is-active' : ''}`}
                onClick={() => setColorMode(cm)}
              >
                {cm}
              </button>
            ))}
          </div>
        )}
        <button
          className={`seg__btn seg__btn--solo${showErosion ? ' is-active' : ''}`}
          onClick={() => setShowErosion((v) => !v)}
          title="show erosional surfaces (red) on the wall sections"
        >
          erosion
        </button>
        <span className="controls-row__label">v.e.</span>
        <input
          type="range"
          className="mini-slider"
          style={{ flex: '0 1 110px' }}
          min={1}
          max={veMax}
          step={0.1}
          value={ve}
          onChange={(e) => setVe(Number(e.target.value))}
          aria-label="vertical exaggeration"
        />
        <span className="controls-row__readout">{ve.toFixed(1)}×</span>
        <button
          className="seg__btn seg__btn--solo"
          onClick={() => {
            const blocks = blocksRef.current
            const b = baseRef.current
            if (blocks && b) b.sceneCtl.resetCamera(scaledBox(blocks.box, ve))
          }}
          title="reset the camera view"
        >
          reset view
        </button>
      </div>
      <div
        ref={containerRef}
        className="block3d-wrap"
        title="drag: orbit · wheel/pinch: zoom · right-drag: pan"
      />
    </div>
  )
}

/** camera framing box at vertical exaggeration ve */
function scaledBox(box: THREE.Box3, ve: number): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(box.min.x, box.min.y * ve, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y * ve, box.max.z),
  )
}
