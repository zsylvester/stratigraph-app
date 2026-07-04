"""Build the TDWB-17-1 (Tulane Delta Basin) dataset bundle.

Follows stratigraph/notebooks/Stratigraph_Tulane_experiments.ipynb:
- Zdata volume (531 x 923 grid, 5 mm spacing, 101 scans every 0.125 days)
- clip below -1050 mm, NaN -> -1050, cosmetic corner fix
- sea level from TDWB_17_1_Subside.csv (TargetOcnZ), cubic-interpolated to
  the scan times
- res = 0.5 mm; no subsidence array (scans are in an absolute frame)
The bundle is downsampled 2x in both spatial directions (10 mm spacing) to
keep it web-sized; classification/maps are computed on the bundled grid.
"""

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scipy.io as sio
from scipy.interpolate import interp1d

import stratigraph as sg
from common import (
    APP_ROOT,
    bundle_dir_for,
    report,
    update_index,
    write_array,
    write_manifest,
)

DATASET_ID = "tdwb17"
MAT_PATH = "/Users/zoltan/Documents/Chronostratigraphy/Tulane/Zdata_TDWB_17_1.mat"
RES = 0.5  # mm
DOWNSAMPLE = 2
QC_DIR = APP_ROOT / "preprocessing" / "qc"


def load_and_clean():
    topo = sio.loadmat(MAT_PATH)["Zdata"].copy()
    topo[topo > -1050] = -1050  # clip artifacts above the ocean-side rim
    topo[np.isnan(topo)] = -1050
    # adjust proximal corners (aesthetic only), verbatim from the notebook
    inds = np.indices(np.shape(topo[:, :, 0]))
    inds2 = np.argwhere(inds[0] < -0.65 * inds[1] + 148)
    inds3 = np.argwhere(inds[0] > 0.58 * inds[1] + 360)
    for i in range(topo.shape[2]):
        topo[:, :, i][inds2[:, 0], inds2[:, 1]] = -1075
        topo[:, :, i][inds3[:, 0], inds3[:, 1]] = -1075
    return topo


def sea_level_curve(nt):
    df = pd.read_csv(
        "/Users/zoltan/Documents/Chronostratigraphy/stratigraph/data/TDWB_17_1_Subside.csv"
    )
    scan_times = np.arange(0, np.max(df["RunTime (days)"]) + 0.1, 0.125)[:nt]
    assert len(scan_times) == nt, f"scan times ({len(scan_times)}) != scans ({nt})"
    days = df["RunTime (days)"].values
    sl = df["TargetOcnZ"].values
    keep = np.hstack((0, np.where(np.diff(days) > 0)[0] + 1))
    f = interp1d(days[keep], sl[keep], kind="cubic")
    return scan_times, f(scan_times)


def main():
    print("loading Zdata...")
    topo = load_and_clean()
    nt = topo.shape[2]
    scan_times, sea_level = sea_level_curve(nt)

    topo = topo[::DOWNSAMPLE, ::DOWNSAMPLE, :].copy()
    print(f"  grid after downsample: {topo.shape}")

    bundle = bundle_dir_for(DATASET_ID, wipe=True)
    arrays = {
        "time": write_array(bundle, "arrays/time.bin", scan_times, "float64"),
        "seaLevel": write_array(bundle, "arrays/sea_level.bin", sea_level, "float64"),
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
    for name, arr in zip(
        ["depositionTime", "erosionTime", "stasisTime", "vacuityTime",
         "depositionThickness", "erosionThickness"],
        maps,
    ):
        derived[name] = write_array(bundle, f"derived/{name}.bin", arr, "float32")

    manifest = {
        "id": DATASET_ID,
        "name": "TDWB-17-1 experiment",
        "description": (
            "Topography scans from the TDWB-17-1 Tulane Delta Basin experiment "
            "(Straub lab), 101 scans over 12.5 days with a rising base level; "
            "downsampled to a 10 mm grid."
        ),
        "citation": "Sylvester, Straub & Covault (2024), Earth-Science Reviews 250, 104706, Figs. 1, 21-24",
        "kind": "grid3d",
        "elevationUnits": "mm",
        "space": {
            "shape": [int(topo.shape[0]), int(topo.shape[1])],
            "spacing": [5.0 * DOWNSAMPLE, 5.0 * DOWNSAMPLE],
            "axes": ["strike", "dip"],
            "units": "mm",
        },
        "time": {
            "n": int(nt),
            "units": "days",
            "displayUnits": "days",
            "displayFactor": 1.0,
            "array": "time",
        },
        "processing": {"resolution": RES, "faciesDepthBins": [0.0, -100.0]},
        "arrays": arrays,
        "derived": derived,
        "views": {
            "dipSection": {
                "defaultLoc": 265 // DOWNSAMPLE,
                "wheelerVmin": -10,
                "wheelerVmax": 10,
            },
            "strikeSection": {"defaultLoc": topo.shape[1] // 2, "wheelerVmin": -10, "wheelerVmax": 10},
        },
    }
    write_manifest(bundle, manifest)
    update_index(DATASET_ID, manifest["name"], manifest["description"])
    print(f"{DATASET_ID}: OK")
    report(manifest)

    # QC render: dip section (age fill) + wheeler at the default location
    QC_DIR.mkdir(exist_ok=True)
    loc = manifest["views"]["dipSection"]["defaultLoc"]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 9))
    s = strat[loc, :, :]
    x = np.arange(s.shape[0]) * 10.0
    cm = matplotlib.colormaps["viridis"]
    for i in range(0, s.shape[1] - 1):
        ax1.fill(
            np.hstack((x, x[::-1])),
            np.hstack((s[:, i], s[:, i + 1][::-1])),
            facecolor=cm(i / (s.shape[1] - 2)),
            linewidth=0,
        )
    ax1.set_title(f"TDWB-17-1 dip section {loc} (age fill)")
    im = ax2.imshow(
        wheeler_strat[loc, :, :].T,
        cmap="RdBu", vmin=-10, vmax=10,
        extent=[0, 10.0 * (s.shape[0] - 1), scan_times[-1], 0],
        aspect="auto", interpolation="none",
    )
    ax2.invert_yaxis()
    ax2.set_ylabel("time (days)")
    fig.colorbar(im, ax=ax2)
    fig.savefig(QC_DIR / "tdwb17_dip_section.png", dpi=130)
    plt.close("all")
    print("QC figure written")


if __name__ == "__main__":
    main()
