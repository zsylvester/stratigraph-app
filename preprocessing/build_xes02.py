"""Build the XES-02 experimental dataset bundle.

Follows stratigraph/notebooks/Stratigraph_XES_02.ipynb (data loading / preprocessing
cells) verbatim:
- load 101 topography + basement scans (261 x 111 grid; rows = strike, 10 mm spacing;
  cols = dip, 50 mm spacing)
- attach scan times / sea level from XES_02_sealevel_and_scantimes.csv, fill the
  missing entries, drop the 8 scans with no data
- resample everything to 3600-s (1 h) time steps (linear for surfaces, smoothing
  spline with two linearly-interpolated patches for sea level)
- cosmetic fix of the proximal corners; fill NaNs
Derived products (validation reference + map view): full-run Wheeler arrays and the
six stratigraphic attribute maps, computed with stratigraph itself.
"""

import os

import matplotlib

matplotlib.use("Agg")

import numpy as np
import pandas as pd
from scipy import interpolate

import stratigraph as sg
from common import (
    APP_ROOT,
    STRATIGRAPH_DATA,
    bundle_dir_for,
    read_array,
    report,
    update_index,
    write_array,
    write_manifest,
)

DATASET_ID = "xes02"
SAMPLING_RATE = 3600  # seconds
RES = 0.5  # mm; elevation threshold for deposition/erosion vs stasis
BAD_SCANS = np.array([2, 5, 12, 25, 30, 31, 48, 60])
QC_DIR = APP_ROOT / "preprocessing" / "qc"


def load_scans():
    T = np.zeros((261, 111, 101))
    dirname = STRATIGRAPH_DATA / "XES_02_topography"
    for filename in os.listdir(dirname):
        surf_no = int(filename[8:-4])
        xyz = np.loadtxt(dirname / filename)
        T[:, :, surf_no - 1] = np.reshape(xyz[:, 2], (261, 111))
    B = np.zeros((261, 111, 101))
    dirname = STRATIGRAPH_DATA / "XES_02_basement_topography"
    for filename in os.listdir(dirname):
        surf_no = int(filename[:-4])
        xyz = np.loadtxt(dirname / filename)
        B[:, :, surf_no - 1] = np.reshape(xyz[:, 2], (261, 111))
    return T, B


def convert_to_seconds(string):
    h, m, s = (int(p) for p in string.split(":"))
    return h * 3600 + m * 60 + s


def load_times_and_sealevel(n_scans):
    df = pd.read_csv(STRATIGRAPH_DATA / "XES_02_sealevel_and_scantimes.csv")
    exp_time = np.nan * np.ones(n_scans)
    sea_level = np.nan * np.ones(n_scans)
    for i in range(n_scans):
        row = df.loc[df["Scan number"] == i + 1]
        if len(row) > 0:
            exp_time[i] = convert_to_seconds(row["run time (hhh:mm:ss)"].values[0])
            sea_level[i] = row["sl(mm)"].values[0]
    for i in np.where(np.isnan(exp_time))[0]:
        exp_time[i] = (exp_time[i - 1] + exp_time[i + 1]) * 0.5
        sea_level[i] = (sea_level[i - 1] + sea_level[i + 1]) * 0.5
    return exp_time, sea_level


def resample_sea_level(exp_time, sea_level):
    time1, sl_spl = sg.resample_elevation_spl(exp_time, sea_level, SAMPLING_RATE)
    _, sl_lin = sg.resample_elevation_int1d(exp_time, sea_level, SAMPLING_RATE)
    sl = sl_spl.copy()
    sl[134:145] = sl_lin[134:145]  # spline overshoots; use linear here
    sl[162:203] = sl_lin[162:203]
    return time1, sl


def resample_volume(exp_time, V, time_new):
    # equivalent to per-pixel sg.resample_elevation_int1d (linear interp1d)
    f = interpolate.interp1d(exp_time, V, axis=2)
    return f(time_new)


def fix_corners(topo, subsid):
    # adjust proximal corners (aesthetic only), verbatim from the notebook
    inds = np.indices(np.shape(subsid[:, :, 0]))
    inds2 = np.argwhere(inds[0] < -5.3 * inds[1] + 125)
    inds3 = np.argwhere(inds[0] > 5.3 * inds[1] + 125)
    for i in range(subsid.shape[2]):
        subsid[:, :, i][inds2[:, 0], inds2[:, 1]] = -229.6
        subsid[:, :, i][inds3[:, 0], inds3[:, 1]] = -229.6
    for i in range(topo.shape[2]):
        topo[:, :, i][inds2[:, 0], inds2[:, 1]] = 0
        topo[:, :, i][inds3[:, 0], inds3[:, 1]] = 0


def fill_nans(V, name):
    """Fill NaNs with the nearest valid value in the same time step."""
    n = int(np.isnan(V).sum())
    if n == 0:
        print(f"  {name}: no NaNs")
        return
    from scipy import ndimage

    for k in range(V.shape[2]):
        layer = V[:, :, k]
        mask = np.isnan(layer)
        if mask.any():
            idx = ndimage.distance_transform_edt(
                mask, return_distances=False, return_indices=True
            )
            V[:, :, k] = layer[tuple(idx)]
    print(f"  {name}: filled {n} NaN cells (nearest neighbor within time step)")


def quantization_qc(bundle, arrays, topo, subsid, strat_ref):
    """Verify int16 quantization keeps the geometry faithful.

    The deposition/erosion/stasis classification is NOT recomputed client-side from
    the quantized volumes (threshold smoothing cascades tiny errors); it ships
    precomputed as derived/wheelerClass. What the client does derive from the
    quantized volumes is strat (reverse cummin) and diff magnitudes, so check those.
    """
    topo_q = read_array(bundle, arrays["topo"])
    subsid_q = read_array(bundle, arrays["subsid"])
    topo_s_q = topo_q + (subsid_q[:, :, -1:] - subsid_q)
    strat_q = sg.topostrat(topo_s_q)
    err = float(np.nanmax(np.abs(strat_q - strat_ref)))
    tol = arrays["topo"]["maxAbsError"] + 2 * arrays["subsid"]["maxAbsError"]
    print(f"  quantization QC: max |strat_quantized - strat_float| = {err:.4f} mm (tol {tol:.4f})")
    assert err <= tol + 1e-9, "quantized strat deviates more than quantization bounds allow"


def main():
    print("loading scans...")
    T, B = load_scans()
    exp_time, sea_level = load_times_and_sealevel(T.shape[2])

    exp_time = np.delete(exp_time, BAD_SCANS)
    sea_level = np.delete(sea_level, BAD_SCANS)
    T = np.delete(T, BAD_SCANS, axis=2)
    B = np.delete(B, BAD_SCANS, axis=2)

    print("resampling to 1-h time steps...")
    time, sea_level_rs = resample_sea_level(exp_time, sea_level)
    topo = resample_volume(exp_time, T, time)
    subsid = resample_volume(exp_time, B, time)
    print(f"  grid: {topo.shape[0]} x {topo.shape[1]}, nt={len(time)}")

    fix_corners(topo, subsid)
    fill_nans(topo, "topo")
    fill_nans(subsid, "subsid")

    print("writing bundle...")
    bundle = bundle_dir_for(DATASET_ID, wipe=True)
    arrays = {
        "time": write_array(bundle, "arrays/time.bin", time, "float64"),
        "seaLevel": write_array(bundle, "arrays/sea_level.bin", sea_level_rs, "float64"),
        "topo": write_array(bundle, "arrays/topo.bin", topo, "int16"),
        "subsid": write_array(bundle, "arrays/subsid.bin", subsid, "int16"),
    }

    print("computing derived products (full-run Wheeler arrays and maps)...")
    topo_s = topo + (subsid[:, :, -1:] - subsid)  # retro-deform to final datum
    strat, wheeler, wheeler_strat, vacuity = sg.create_wheeler_diagram(topo_s, RES)
    (
        deposition_time,
        erosion_time,
        stasis_time,
        vacuity_time,
        deposition_thickness,
        erosion_thickness,
    ) = sg.compute_strat_maps(strat, wheeler, wheeler_strat, vacuity)

    derived = {}
    # deposition/erosion/stasis classification (+1/-1/0), from the float64 pipeline.
    # End-time independent: retro-deformation shifts all surfaces at a location by the
    # same constant and the threshold smoothing is causal, so the classification for
    # time steps <= k is the prefix of this array. int8, one file, exact.
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
    for name, arr in [
        ("depositionTime", deposition_time),
        ("erosionTime", erosion_time),
        ("stasisTime", stasis_time),
        ("vacuityTime", vacuity_time),
        ("depositionThickness", deposition_thickness),
        ("erosionThickness", erosion_thickness),
    ]:
        derived[name] = write_array(bundle, f"derived/{name}.bin", arr, "float32")

    print("saving QC reference (float64 pipeline outputs)...")
    QC_DIR.mkdir(exist_ok=True)
    np.savez_compressed(
        QC_DIR / "xes02_reference.npz",
        strat=strat.astype(np.float32),
        wheeler=wheeler.astype(np.float32),
        wheeler_strat=wheeler_strat.astype(np.float32),
        vacuity=vacuity.astype(np.int8),
        time=time,
        sea_level=sea_level_rs,
    )

    quantization_qc(bundle, arrays, topo, subsid, strat)

    manifest = {
        "id": DATASET_ID,
        "name": "XES-02 experiment",
        "description": (
            "Topography and basement scans from the XES-02 subsiding-basin flume "
            "experiment (St. Anthony Falls Laboratory, University of Minnesota), "
            "resampled to 1-hour time steps; sea level history included."
        ),
        "citation": "Sylvester, Straub & Covault (2024), Earth-Science Reviews 250, 104706, Figs. 15-20",
        "kind": "grid3d",
        "elevationUnits": "mm",
        "space": {
            "shape": [int(topo.shape[0]), int(topo.shape[1])],
            "spacing": [10.0, 50.0],
            "axes": ["strike", "dip"],
            "units": "mm",
        },
        "time": {
            "n": int(len(time)),
            "units": "seconds",
            "displayUnits": "hours",
            "displayFactor": 1.0 / 3600.0,
            "array": "time",
        },
        "processing": {
            "resolution": RES,
            "samplingRate": SAMPLING_RATE,
            "note": (
                "Cross sections / Wheeler diagrams at time step k use retro-deformed "
                "surfaces topo[i] + subsid[k] - subsid[i] for i <= k. "
                "faciesDepthBins are water depths (mm) separating topset/foreset/deep."
            ),
            "faciesDepthBins": [0.0, -100.0],
        },
        "arrays": arrays,
        "derived": derived,
        "views": {
            "dipSection": {"defaultLoc": 130, "wheelerVmin": -10, "wheelerVmax": 10},
            "strikeSection": {"defaultLoc": 40, "wheelerVmin": -10, "wheelerVmax": 10},
            "wheelerMap": {"vmin": -60, "vmax": 60},
            "seaLevelPlot": {"xlim": [-100, -370]},
            "maps": {
                "depositionTime": {"vmin": 0, "vmax": 1},
                "erosionTime": {"vmin": 0, "vmax": 0.5},
            },
            "block3d": {"veMax": 3},
        },
    }
    write_manifest(bundle, manifest)
    update_index(DATASET_ID, manifest["name"], manifest["description"])
    print(f"{DATASET_ID}: OK")
    report(manifest)
    print(
        "NOTE: the bundle was wiped — re-run build_xes02_photos.py to restore "
        "the overhead-photo textures (textures/ + the manifest entry)."
    )


if __name__ == "__main__":
    main()
