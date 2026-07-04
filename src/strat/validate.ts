/**
 * Dev-only validation of the TS strat core against the float64 Python pipeline
 * (reference slices exported by preprocessing/export_ref_slices.py).
 *
 * Run in the browser console / preview:
 *   const v = await import('/src/strat/validate.ts'); await v.validateXes02()
 */

import { loadDataset } from '../data/loader'
import { gridSection, retroDeform, stratUpTo, wheelerStrat } from './core'
import { computeStratMaps } from './maps'

export async function validateXes02() {
  const qc = await (await fetch(`${import.meta.env.BASE_URL}qc/qc.json`)).json()
  const load = async (p: string) =>
    new Float32Array(await (await fetch(`${import.meta.env.BASE_URL}qc/${p}`)).arrayBuffer())
  const refStrat = await load(qc.strat.path)
  const refWs = await load(qc.wheelerStrat.path)

  const ds = await loadDataset('xes02')
  const sec = await gridSection(ds, 'dip', qc.dipLoc)
  const { n, nt } = sec
  const k = nt - 1
  const topoS = retroDeform(sec, k)
  const strat = stratUpTo(topoS, n, nt, k)
  const ws = wheelerStrat(sec, topoS, strat, k)

  let maxStratErr = 0
  for (let i = 0; i < strat.length; i++) {
    const e = Math.abs(strat[i] - refStrat[i])
    if (Number.isFinite(e) && e > maxStratErr) maxStratErr = e
  }

  // sign disagreements only matter when the value is outside the white
  // stasis band of the Wheeler colormap (±1% of the ±10 scale = 0.2 mm);
  // below that both render white and the difference is quantization noise
  const band = 0.2
  let maxWsErr = 0
  let signDisagree = 0
  for (let i = 0; i < ws.length; i++) {
    const e = Math.abs(ws[i] - refWs[i])
    if (Number.isFinite(e) && e > maxWsErr) maxWsErr = e
    if (
      Math.sign(ws[i]) !== Math.sign(refWs[i]) &&
      Math.max(Math.abs(ws[i]), Math.abs(refWs[i])) > band
    )
      signDisagree++
  }

  const tol =
    (ds.manifest.arrays.topo.scale ?? 0) / 2 + (ds.manifest.arrays.subsid.scale ?? 0)
  // client-computed full-run attribute maps vs the Python derived maps
  const [topoV, subsidV, clsV] = await Promise.all([
    ds.array('topo'),
    ds.array('subsid'),
    ds.array('wheelerClass'),
  ])
  const space = ds.manifest.space as { shape: [number, number] }
  const nLoc = space.shape[0] * space.shape[1]
  const maps = computeStratMaps(
    topoV.data as Float32Array,
    subsidV.data as Float32Array,
    clsV.data as Int8Array,
    nLoc,
    nt,
    nt - 1,
  )
  const mapErr: Record<string, number> = {}
  for (const key of [
    'depositionTime',
    'erosionTime',
    'stasisTime',
    'vacuityTime',
    'depositionThickness',
    'erosionThickness',
  ] as const) {
    const ref = await ds.array(key)
    let maxE = 0
    let sumE = 0
    let cnt = 0
    for (let i = 0; i < nLoc; i++) {
      const e = Math.abs(maps[key][i] - (ref.data[i] as number))
      if (Number.isFinite(e)) {
        if (e > maxE) maxE = e
        sumE += e
        cnt++
      }
    }
    mapErr[key] = maxE
    mapErr[`${key}Mean`] = sumE / cnt
  }

  const result = {
    n,
    nt,
    maxStratErr,
    stratTol: tol,
    maxWsErr,
    signDisagreeFrac: signDisagree / ws.length,
    mapErr,
    // time-fraction maps: mean error must be ~one interval (1/310); thickness
    // maps within quantization noise accumulation
    pass:
      maxStratErr <= tol * 1.01 &&
      signDisagree === 0 &&
      mapErr.depositionTimeMean < 2 / (nt - 1) &&
      mapErr.depositionThickness < 0.1,
  }
  console.log('[validateXes02]', result)
  return result
}
