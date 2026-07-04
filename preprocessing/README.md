# Preprocessing pipeline

Builds the dataset bundles the web app consumes (format: see [../FORMAT.md](../FORMAT.md)).
Each script reads raw data from the `stratigraph` repo (`../../stratigraph/data`, override
with `STRATIGRAPH_ROOT`) and writes a bundle into `../public/data/<dataset-id>/`.

Run everything with the `stratigraph` conda env (the scripts import the `stratigraph`
package itself so the app data is produced by the exact code behind the 2024 paper):

```sh
PY=/Users/zoltan/miniforge3/envs/stratigraph/bin/python
$PY build_barrell.py    # Barrell (1917) elevation curve            (~1 s)
$PY build_wheeler.py    # Wheeler (1964) reconstruction             (~1 min, line tracking)
$PY build_xes02.py      # XES-02 experiment                         (~2-3 min)
$PY qc_checks.py        # regenerate paper figures from the bundles (~1 min)
```

`qc_checks.py` reads the bundles back exactly the way the app will (manifest + raw
binary only), regenerates the key figures into `qc/*.png` for visual comparison with
the paper, and checks numerically that int16 quantization stays within bounds.

## Division of labor with the app

Bundles store analysis *inputs* (`topo`, `subsid`, sea level, time). The app derives
cross sections, Wheeler diagrams, Barrell plots and attribute maps client-side per
interaction (reverse cummin, retro-deformation, sums over time — all cheap).

One exception: the deposition/erosion/stasis classification (`smooth_elevation_series`
+ diff) is a stateful threshold filter, so quantization noise cascades through it.
It therefore ships precomputed from the float64 pipeline (`derived/wheelerClass`,
int8, end-time independent) rather than being recomputed client-side. The full-run
attribute maps also ship precomputed (`derived/*.bin`, float32).

`qc/xes02_reference.npz` holds the float64 pipeline outputs (strat/wheeler volumes) —
the reference for validating the TypeScript port in later phases. It is not part of
the served bundle.
