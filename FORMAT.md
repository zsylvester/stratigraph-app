# Dataset bundle format

The web app consumes *dataset bundles*: one directory per dataset under `public/data/`,
each self-describing via a `manifest.json`. Bundles are produced offline by the scripts in
`preprocessing/` (which reuse the `stratigraph` Python package — the canonical
implementation from Sylvester, Straub & Covault 2024, ESR).

```
public/data/
  index.json              # list of available datasets
  <dataset-id>/
    manifest.json         # everything the app needs to know about the dataset
    arrays/*.bin          # raw little-endian binary arrays (see below)
    derived/*.bin         # optional precomputed products (e.g. attribute maps)
    assets/*              # optional images (e.g. original Barrell plot scan)
```

## Design principle

Bundles store the *inputs* of the stratigraphic analysis (`topo`, `subsid`, sea level,
time), not per-time-step renderings. The core `stratigraph` operations that turn these
into what the plots show are cheap enough to run in the browser on every interaction:

- `topostrat` (preserved stratigraphy) = reverse cumulative minimum along time
- retro-deformation to time step `k`: `topo_s[i] = topo[i] + (subsid[k] - subsid[i])`
- Wheeler classification: sign of time-diff of threshold-smoothed elevation series
  (`smooth_elevation_series`, threshold `processing.resolution`)
- attribute maps: sums over the time axis of the Wheeler arrays

These will be ported to TypeScript in the app and validated against the Python outputs
(see `preprocessing/qc_checks.py`). Precomputed `derived/` products let views work
before/without the TS port and serve as the validation reference.

## index.json

```json
{ "datasets": [ { "id": "xes02", "name": "...", "path": "xes02/" }, ... ] }
```

## Binary array encoding

Raw little-endian, C-order (row-major), no header. `manifest.json` carries the metadata:

```json
"topo": {
  "path": "arrays/topo.bin",
  "dtype": "int16",            // int16 | float32 | float64
  "shape": [261, 111, 312],
  "scale": 0.0205,             // int16 only: value = raw * scale + offset
  "offset": -650.3,            // int16 only
  "nan": -32768                // int16 only: sentinel for NaN
}
```

Quantized int16 is used for large volumes (precision = scale/2, chosen ≫ finer than
`processing.resolution`, so classification is unaffected — verified in QC).

## manifest.json

Common fields:

| field | meaning |
|---|---|
| `id`, `name`, `description`, `citation` | display metadata |
| `kind` | `curve1d` \| `section2d` \| `grid3d` |
| `time` | `{ n, units, displayUnits, displayFactor, array }` — time vector always stored as float64 `.bin` |
| `elevationUnits` | units of all elevation arrays |
| `processing` | `{ resolution, ... }` — `resolution` is the `res` threshold used by the Wheeler/stasis classification, in `elevationUnits` |
| `arrays` | map of array name → encoding (above) |
| `derived` | same encoding, precomputed products |
| `views` | per-plot defaults (initial section location, color limits, y-limits) matching the 2024 paper figures |

### kind = `curve1d` (Barrell plot)

Arrays: `time (n)`, `elevation (n)`. Single-location elevation history; the app derives
the Barrell plot and chronostratigraphic column from it.

### kind = `section2d` (Wheeler 1964 reconstruction)

Arrays: `topo (nt, nx)`, `subsid (nt, nx)` — topographic and basement elevation through
time along one dip line. `space: { nx, dx, x0, units }`. Row `i` is the surface at time
step `i` (C-order ⇒ each surface is contiguous). `keySurfaceIndices` marks the time steps
that correspond to the originally digitized surfaces.

### kind = `grid3d` (XES-02)

Arrays: `topo (nrows, ncols, nt)`, `subsid (nrows, ncols, nt)`, `seaLevel (nt)`.
`space: { shape: [nrows, ncols], spacing: [drow, dcol], axes: ["strike", "dip"], units }`
— row index = across-basin (strike) position, col index = downstream (dip) position.
A **dip section** fixes a row `r`: slice `[r, :, :]` → `(ncols, nt)`.
A **strike section** fixes a col `c`: slice `[:, c, :]` → `(nrows, nt)`.
Time is the last (contiguous) axis: one location's elevation history is one contiguous run,
which is what the Wheeler smoothing loop iterates over.

`derived/` for grid3d: the six attribute maps from `compute_strat_maps`
(deposition/erosion/stasis/vacuity time fractions, deposition/erosion thickness) computed
over the full run, float32 `(nrows, ncols)`.
