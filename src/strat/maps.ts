/**
 * Time-dependent stratigraphic attribute maps: compute_strat_maps up to an
 * arbitrary time step k, from the raw volumes + shipped classification.
 *
 * Works on y = topo - subsid per location, which makes every quantity
 * datum-independent (retro-deformation adds a per-location constant that
 * cancels in differences and preserves cummin structure). Time fractions are
 * normalized by elapsed intervals k, so a map is comparable across time.
 */

export interface StratMaps {
  k: number
  depositionTime: Float32Array
  erosionTime: Float32Array
  stasisTime: Float32Array
  vacuityTime: Float32Array
  depositionThickness: Float32Array
  erosionThickness: Float32Array
}

const EPS = 1e-6

export function computeStratMaps(
  topo: Float32Array,
  subsid: Float32Array,
  cls: Int8Array,
  nLoc: number,
  nt: number,
  k: number,
): StratMaps {
  const kk = Math.max(1, Math.min(k, nt - 1))
  const depT = new Float32Array(nLoc)
  const eroT = new Float32Array(nLoc)
  const staT = new Float32Array(nLoc)
  const vacT = new Float32Array(nLoc)
  const depTh = new Float32Array(nLoc)
  const eroTh = new Float32Array(nLoc)

  const m = new Float32Array(kk + 1) // backward cummin scratch

  for (let j = 0; j < nLoc; j++) {
    const b = j * nt
    const bc = j * (nt - 1)

    let mn = topo[b + kk] - subsid[b + kk]
    m[kk] = mn
    for (let i = kk - 1; i >= 0; i--) {
      const y = topo[b + i] - subsid[b + i]
      if (y < mn) mn = y
      m[i] = mn
    }

    let nDep = 0
    let nEro = 0
    let nVac = 0
    let eSum = 0
    for (let i = 0; i < kk; i++) {
      const c = cls[bc + i]
      if (c > 0) {
        if (m[i + 1] - m[i] > EPS) nDep++
        else nVac++
      } else if (c < 0) {
        nEro++
        eSum += topo[b + i + 1] - subsid[b + i + 1] - (topo[b + i] - subsid[b + i])
      }
    }
    depT[j] = nDep / kk
    eroT[j] = nEro / kk
    staT[j] = (kk - nDep - nEro - nVac) / kk
    vacT[j] = nVac / kk
    depTh[j] = m[kk] - m[0] // strat[k] - strat[0]
    eroTh[j] = eSum // sum of elevation drops (negative), as in the notebook
  }

  return {
    k: kk,
    depositionTime: depT,
    erosionTime: eroT,
    stasisTime: staT,
    vacuityTime: vacT,
    depositionThickness: depTh,
    erosionThickness: eroTh,
  }
}
