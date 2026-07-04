"""Build the Wheeler (1964) figure-reconstruction dataset bundle.

Follows stratigraph/notebooks/Stratigraph_Barrell_and_Wheeler_original_plots.ipynb
('The original Wheeler diagram' section) verbatim:
- track the 10 digitized topographic surfaces in data/wheeler_figure_01..10.tif
- interpolate onto a common x grid (dx = 50 m)
- build basement (uplift) history
- resample both to 250-kyr time steps (37 steps over 9 Myr)
"""

import glob

import matplotlib

matplotlib.use("Agg")

import numpy as np
from scipy import interpolate

import stratigraph as sg
from common import (
    STRATIGRAPH_DATA,
    bundle_dir_for,
    report,
    update_index,
    write_array,
    write_manifest,
)

DATASET_ID = "wheeler1964"


def track_surfaces():
    fnames = sorted(glob.glob(str(STRATIGRAPH_DATA / "wheeler_figure*.tif")))[:-1]
    assert len(fnames) == 10, f"expected 10 surface images, got {len(fnames)}"
    XS, YS = [], []
    for fname in fnames:
        print(f"  tracking {fname.split('/')[-1]}")
        x_pix, y_pix = sg.read_and_track_line(fname)
        delta = 10.0  # m per pixel, both directions
        x = 0.5 * delta + x_pix * delta
        y = 0.5 * delta + y_pix * delta
        xs, ys = sg.resample_and_smooth(x, y, 50, 5000)
        XS.append(xs)
        YS.append(ys)

    min_x, max_x = 0, 10000
    for i in range(len(XS)):
        min_x = max(min_x, min(XS[i]))
        max_x = min(max_x, max(XS[i]))
    xnew = np.arange(min_x, max_x, 50)

    topo = np.zeros((len(XS), len(xnew)))
    for i in range(len(XS)):
        f = interpolate.interp1d(XS[i], YS[i])
        topo[i, :] = f(xnew)
    topo = 2000 - topo  # image y axis points down
    return xnew, topo


def build_basement(topo):
    basement_0 = np.min(topo[1, :]) + topo[0, :] - topo[1, :]
    basement_7 = topo[0, :]
    total_uplift = basement_7 - basement_0
    # uplift is sped up between time steps 5 and 6
    basement_5 = basement_0 + total_uplift * 0.25
    basement_6 = basement_0 + total_uplift * 0.75
    basement = np.zeros_like(topo)
    basement[0:5, :] = basement_0
    basement[5, :] = basement_5
    basement[6, :] = basement_6
    basement[7:, :] = basement_7
    return basement


def resample(topo, basement):
    time = np.arange(0, 10) * 1e6  # years
    sampling_rate = 250000  # years

    time1 = None
    topo1 = np.zeros((37, topo.shape[1]))
    for i in range(topo.shape[1]):
        time1, topo1[:, i] = sg.resample_elevation_spl(time, topo[:, i].copy(), sampling_rate)
    # no erosion at the bottom left side:
    for k in (1, 2, 3):
        topo1[k, :] = np.maximum(topo1[0, :], topo1[k, :])

    subsid = np.zeros((len(time1), basement.shape[1]))
    for i in range(basement.shape[1]):
        _, subsid[:, i] = sg.resample_elevation_int1d(time, basement[:, i].copy(), sampling_rate)
    return time1, topo1, subsid


def main():
    xnew, topo10, basement10 = (None, None, None)
    xnew, topo10 = track_surfaces()
    basement10 = build_basement(topo10)
    time1, topo1, subsid = resample(topo10, basement10)
    print(f"  grid: nx={len(xnew)}, nt={len(time1)}")

    bundle = bundle_dir_for(DATASET_ID, wipe=True)
    arrays = {
        "time": write_array(bundle, "arrays/time.bin", time1, "float64"),
        "topo": write_array(bundle, "arrays/topo.bin", topo1, "float32"),
        "subsid": write_array(bundle, "arrays/subsid.bin", subsid, "float32"),
    }

    manifest = {
        "id": DATASET_ID,
        "name": "Wheeler (1964) diagram reconstruction",
        "description": (
            "Topographic surfaces digitized from Harry Wheeler's 1964 baselevel-"
            "transit figure, with a reconstructed basement-uplift history; the basis "
            "for reconstructing his chronostratigraphic diagram."
        ),
        "citation": "Sylvester, Straub & Covault (2024), Earth-Science Reviews 250, 104706, Figs. 3-5",
        "kind": "section2d",
        "elevationUnits": "m",
        "space": {
            "nx": int(topo1.shape[1]),
            "dx": 50.0,
            "x0": float(xnew[0]),
            "units": "m",
        },
        "time": {
            "n": int(len(time1)),
            "units": "years",
            "displayUnits": "Myr",
            "displayFactor": 1e-6,
            "array": "time",
        },
        "processing": {
            "resolution": 0.1,
            # the digitized surfaces are stored in their FINAL positions, so
            # displaying time step k shifts the whole stack uniformly by
            # subsid[k] - subsid[-1] (the notebook's t = topo - subsid[-1] +
            # subsid[k]), NOT per-surface like scanned experiment data
            "deformation": "final-datum",
            "note": (
                "Wheeler diagram is computed on topo as stored, matching the "
                "notebook; cross sections at time step k shift the whole stack "
                "by subsid[k] - subsid[-1] (final-datum deformation)."
            ),
        },
        # time steps corresponding to the 10 originally digitized surfaces
        "keySurfaceIndices": list(range(0, 37, 4)),
        "arrays": arrays,
        "views": {
            "section": {"bottom": -260.0, "ylim": [-260.0, 1600.0], "surfaceLineEvery": 4},
            "wheeler": {"vmin": -100.0, "vmax": 100.0},
        },
    }
    write_manifest(bundle, manifest)
    update_index(DATASET_ID, manifest["name"], manifest["description"])
    print(f"{DATASET_ID}: OK")
    report(manifest)


if __name__ == "__main__":
    main()
