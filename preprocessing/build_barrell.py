"""Build the Barrell dataset bundle.

Reproduces the elevation curve of Barrell (1917) Fig. 5 exactly as in
stratigraph/notebooks/Stratigraph_Barrell_and_Wheeler_original_plots.ipynb
(cell 'Barrell's original plot'), including the digitized-scan underlay image.
"""

import shutil

import numpy as np

from common import (
    STRATIGRAPH_DATA,
    bundle_dir_for,
    report,
    update_index,
    write_array,
    write_manifest,
)

DATASET_ID = "barrell"


def build_curve():
    # verbatim from the notebook
    max_time = 1e6
    max_elevation = 175
    x = np.linspace(4.705, 7.857, 1000)
    c = np.sin(x) - 0.25 * np.cos(8 * x) - 0.05 * np.cos(64 * x)
    time = (x - 4.705) * max_time / np.max(x - 4.705)
    elevation = (c + 1.0) * 0.396 * max_elevation + 21
    underlay_ymax = float(np.max(elevation))  # imshow extent uses max before the fix
    elevation[0] = 0.17  # eliminate erosion at the very beginning
    elevation[1] = 0.19
    return time, elevation, underlay_ymax


def main():
    time, elevation, underlay_ymax = build_curve()
    bundle = bundle_dir_for(DATASET_ID, wipe=True)

    arrays = {
        "time": write_array(bundle, "arrays/time.bin", time, "float64"),
        "elevation": write_array(bundle, "arrays/elevation.bin", elevation, "float64"),
    }

    scan = STRATIGRAPH_DATA / "barrell_strat_plot_copy.png"
    assets = {}
    if scan.exists():
        (bundle / "assets").mkdir(exist_ok=True)
        shutil.copy(scan, bundle / "assets" / "barrell_original.png")
        assets["barrellOriginal"] = {
            "path": "assets/barrell_original.png",
            # extent for overlaying the curve on the scan: [x0, x1, y0, y1]
            "extent": [0.0, float(time[-1]), 0.0, underlay_ymax],
        }

    manifest = {
        "id": DATASET_ID,
        "name": "Barrell (1917) elevation curve",
        "description": (
            "Reconstruction of the sediment-surface elevation curve from Joseph "
            "Barrell's 1917 'Rhythms and the measurement of geologic time' (Fig. 5), "
            "used to derive his stratigraphic column."
        ),
        "citation": "Sylvester, Straub & Covault (2024), Earth-Science Reviews 250, 104706, Fig. 2",
        "kind": "curve1d",
        "elevationUnits": "m",
        "time": {
            "n": len(time),
            "units": "years",
            "displayUnits": "years",
            "displayFactor": 1.0,
            "array": "time",
        },
        "processing": {"resolution": 0.0001},
        "arrays": arrays,
        "assets": assets,
        "views": {
            "barrell": {
                "maxElevation": float(np.max(elevation)),
                "maxTime": float(np.max(time)),
            }
        },
    }
    write_manifest(bundle, manifest)
    update_index(DATASET_ID, manifest["name"], manifest["description"])
    print(f"{DATASET_ID}: OK")
    report(manifest)


if __name__ == "__main__":
    main()
