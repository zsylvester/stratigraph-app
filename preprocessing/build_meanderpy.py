"""Build the meanderpy channel-belt model dataset bundle.

Follows stratigraph/notebooks/Stratigraph_meanderpy_model.ipynb, using the
example_3 model of the paper (Figs. 6-14). The model writes 3 surfaces per
5-year migration event (post-erosion, post-point-bar, post-levee). Keeping
the post-erosion surfaces makes every third Wheeler row a stasis stripe at
active locations, so the bundle keeps only the two DEPOSITIONAL surfaces per
event (post-point-bar, post-levee) — the erosion is absorbed into the
point-bar interval, matching the model's own strat/facies structure:
- 121 surfaces; interval facies alternate point bar / levee
  (derived/layerFacies: 0 / 1), the paper's block-diagram coloring
- classification res = 0.05 m; no subsidence, no sea level
Downsampled 3x spatially (30 m grid) to keep the bundle web-sized.
"""

import matplotlib

matplotlib.use("Agg")

import h5py
import matplotlib.pyplot as plt
import numpy as np

import stratigraph as sg
from common import (
    APP_ROOT,
    bundle_dir_for,
    report,
    update_index,
    write_array,
    write_manifest,
)

DATASET_ID = "meanderpy"
H5_PATH = "/Users/zoltan/Documents/Chronostratigraphy/ESR_paper/Data/meanderpy_strat_model_example_3.hdf5"
RES = 0.05  # m
DOWNSAMPLE = 3
DT_EVENT = 5.0  # years per erosion/point-bar/levee event
QC_DIR = APP_ROOT / "preprocessing" / "qc"


def main():
    print("loading model (strided read)...")
    with h5py.File(H5_PATH) as f:
        model = f["model"]
        topo = np.array(model["topo"][::DOWNSAMPLE, ::DOWNSAMPLE, :])
        facies = np.array(model["facies"])  # per strat layer: alternating codes
        pb_code = int(np.array(model["point bar"]))
        levee_code = int(np.array(model["levee"]))
        dx = float(np.array(model["dx"])) * DOWNSAMPLE
    nrows, ncols, nt_raw = topo.shape
    n_events = (nt_raw - 1) // 3
    assert nt_raw == 3 * n_events + 1, "expected 3 surfaces per event"
    assert len(facies) == 2 * n_events, "expected 2 depositional layers per event"

    # keep only the depositional surfaces: post-point-bar and post-levee per
    # event (drop post-erosion; erosion merges into the point-bar interval)
    idx = [0]
    for k in range(n_events):
        idx.extend([3 * k + 2, 3 * k + 3])
    topo = topo[:, :, idx]
    nt = topo.shape[2]
    print(f"  grid: {nrows} x {ncols}, nt={nt} (from {nt_raw}), dx={dx} m")

    # surface times: point bar mid-event, levee at the end (uniform 2.5 yr)
    time = np.zeros(nt)
    for k in range(n_events):
        time[2 * k + 1] = k * DT_EVENT + DT_EVENT / 2
        time[2 * k + 2] = (k + 1) * DT_EVENT

    # per-interval facies alternate exactly like the model's strat layers
    layer_facies = np.array(
        [0 if int(f) == pb_code else 1 for f in facies], dtype=np.int8
    )
    assert len(layer_facies) == nt - 1

    bundle = bundle_dir_for(DATASET_ID, wipe=True)
    arrays = {
        "time": write_array(bundle, "arrays/time.bin", time, "float64"),
        "topo": write_array(bundle, "arrays/topo.bin", topo, "int16"),
    }

    print("computing derived products...")
    strat, wheeler, wheeler_strat, vacuity = sg.create_wheeler_diagram(topo, RES)
    maps = sg.compute_strat_maps(strat, wheeler, wheeler_strat, vacuity)

    derived = {}
    wheeler_class = np.sign(wheeler).astype(np.int8)
    out = bundle / "derived" / "wheelerClass.bin"
    out.parent.mkdir(exist_ok=True)
    wheeler_class.tofile(out)
    derived["wheelerClass"] = {
        "path": "derived/wheelerClass.bin",
        "dtype": "int8",
        "shape": list(wheeler_class.shape),
        "note": "+1 deposition, -1 erosion, 0 stasis; last axis = time intervals",
    }
    derived["layerFacies"] = {
        "path": "derived/layerFacies.bin",
        "dtype": "int8",
        "shape": [int(nt - 1)],
        "note": "0 point bar (erosion absorbed), 1 levee",
    }
    layer_facies.tofile(bundle / "derived" / "layerFacies.bin")
    for name, arr in zip(
        ["depositionTime", "erosionTime", "stasisTime", "vacuityTime",
         "depositionThickness", "erosionThickness"],
        maps,
    ):
        derived[name] = write_array(bundle, f"derived/{name}.bin", arr, "float32")

    manifest = {
        "id": DATASET_ID,
        "name": "meanderpy channel-belt model",
        "description": (
            "Meandering-river channel-belt model built with meanderpy: 60 "
            "migration events (point bar and levee deposition every 5 years); "
            "30 m grid, elevations in meters."
        ),
        "citation": "Sylvester, Straub & Covault (2024), Earth-Science Reviews 250, 104706, Figs. 6-14",
        "kind": "grid3d",
        "elevationUnits": "m",
        "space": {
            "shape": [int(nrows), int(ncols)],
            "spacing": [dx, dx],
            "axes": ["strike", "dip"],
            "units": "m",
        },
        "time": {
            "n": int(nt),
            "units": "years",
            "displayUnits": "years",
            "displayFactor": 1.0,
            "array": "time",
        },
        "processing": {
            "resolution": RES,
            "layerFaciesLabels": ["sand", "mud"],
            "note": "no sea level / subsidence; facies are per-layer (layerFacies)",
        },
        "arrays": arrays,
        "derived": derived,
        "views": {
            "dipSection": {
                "defaultLoc": 489 // DOWNSAMPLE,  # Fig. 13A row
                "wheelerVmin": -3,
                "wheelerVmax": 3,
            },
            "strikeSection": {"defaultLoc": ncols // 2, "wheelerVmin": -3, "wheelerVmax": 3},
            "section": {"equalAxes": True},
            # low relief on a wide floodplain: default contour density is too busy
            "map": {"contourLevels": 12},
            # one Wheeler row per 5-yr event (pb + levee summed), as in the
            # paper's Fig. 12 — avoids thick/thin row striping
            "wheeler": {"rowStep": 2},
        },
    }
    write_manifest(bundle, manifest)
    update_index(DATASET_ID, manifest["name"], manifest["description"])
    print(f"{DATASET_ID}: OK")
    report(manifest)

    # QC render: dip section with layer-facies fill + wheeler
    QC_DIR.mkdir(exist_ok=True)
    loc = manifest["views"]["dipSection"]["defaultLoc"]
    facies_colors = ["#e5e500", "#7f3f00"]  # point bar, levee (notebook colors)
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 9))
    s = strat[loc, :, :]
    x = np.arange(s.shape[0]) * dx
    for i in range(0, s.shape[1] - 1):
        lf = layer_facies[i]
        color = facies_colors[lf] if lf >= 0 else "#cccccc"
        ax1.fill(
            np.hstack((x, x[::-1])),
            np.hstack((s[:, i], s[:, i + 1][::-1])),
            facecolor=color, linewidth=0,
        )
    ax1.set_title(f"meanderpy dip section {loc} (layer facies)")
    im = ax2.imshow(
        wheeler_strat[loc, :, :].T,
        cmap="RdBu", vmin=-3, vmax=3,
        extent=[0, dx * (s.shape[0] - 1), time[-1], 0],
        aspect="auto", interpolation="none",
    )
    ax2.invert_yaxis()
    ax2.set_ylabel("time (years)")
    fig.colorbar(im, ax=ax2)
    fig.savefig(QC_DIR / "meanderpy_dip_section.png", dpi=130)
    plt.close("all")
    print("QC figure written")


if __name__ == "__main__":
    main()
