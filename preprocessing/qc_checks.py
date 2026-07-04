"""QC for dataset bundles: read them back the way the app will (manifest + .bin only)
and regenerate the key figures from the 2024 paper for visual comparison, plus
numerical checks of quantization impact.

Outputs PNGs into preprocessing/qc/.
"""

import json

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib import gridspec
from matplotlib.colors import ListedColormap

import stratigraph as sg
from common import APP_ROOT, DATA_ROOT, read_array

QC_DIR = APP_ROOT / "preprocessing" / "qc"
QC_DIR.mkdir(exist_ok=True)


def load_bundle(dataset_id):
    bundle = DATA_ROOT / dataset_id
    manifest = json.loads((bundle / "manifest.json").read_text())
    arrays = {k: read_array(bundle, e) for k, e in manifest.get("arrays", {}).items()}
    derived = {k: read_array(bundle, e) for k, e in manifest.get("derived", {}).items()}
    return manifest, arrays, derived


def wheeler_cmap(vmin=-10, vmax=10):
    rdbu = matplotlib.colormaps["RdBu"].resampled(256)
    newcolors = rdbu(np.linspace(0, 1, 256))
    newcolors[126:131, :] = np.array([1, 1, 1, 1])  # white band at zero (stasis)
    return ListedColormap(newcolors)


def qc_barrell():
    manifest, arrays, _ = load_bundle("barrell")
    time, elevation = arrays["time"], arrays["elevation"]
    fig, *_ = sg.plot_strat_diagram(
        elevation.copy(), "m", time, "years", manifest["processing"]["resolution"],
        max_elevation=np.max(elevation), max_time=np.max(time), plotting=True,
    )
    fig.savefig(QC_DIR / "barrell_strat_diagram.png", dpi=150)
    plt.close("all")
    print("barrell: strat diagram rendered")


def qc_wheeler1964():
    manifest, arrays, _ = load_bundle("wheeler1964")
    topo, subsid, time = arrays["topo"], arrays["subsid"], arrays["time"]
    sp = manifest["space"]
    x = sp["x0"] + sp["dx"] * np.arange(sp["nx"])
    res = manifest["processing"]["resolution"]

    end_time = topo.shape[0] - 1
    # retro-deform to end_time datum, then preserved stratigraphy (reverse cummin)
    t = topo[: end_time + 1] - subsid[-1:] + subsid[end_time:end_time + 1]
    strat = np.minimum.accumulate(t[::-1, :], axis=0)[::-1, :]

    fig = plt.figure(figsize=(7.5, 10))
    # section and Wheeler panels share left/right edges; colorbar gets its own axes
    # so it does not steal width from the lower panel
    ax1 = fig.add_axes([0.10, 0.72, 0.78, 0.23])
    ax2 = fig.add_axes([0.10, 0.06, 0.78, 0.60])
    cax = fig.add_axes([0.90, 0.06, 0.025, 0.60])
    for i in range(strat.shape[0] - 1):
        xx = np.hstack((x, x[::-1]))
        yy = np.hstack((strat[i, :], strat[i + 1, :][::-1]))
        ax1.fill(xx, yy, facecolor="palegoldenrod", edgecolor=None, linewidth=0.5)
        if i % manifest["views"]["section"]["surfaceLineEvery"] == 0:
            ax1.plot(x, strat[i, :], "k", linewidth=0.5)
    ax1.plot(x, strat[-1, :], "k", linewidth=1)
    xx = np.hstack((x[0], x[-1], x[::-1]))
    yy = np.hstack((-260, -260, subsid[end_time, :][::-1]))
    ax1.fill(xx, yy, facecolor="lightgray", edgecolor="k")
    ax1.set_xlim(x[0], x[-1])
    ax1.set_ylim(*manifest["views"]["section"]["ylim"])
    ax1.set_title("cross section (final time step)")

    _, _, wheeler_strat, _, _ = sg.create_wheeler_diagram_2D(topo.T, res)
    v = manifest["views"]["wheeler"]
    im = ax2.imshow(
        wheeler_strat.T, cmap="RdBu", vmin=v["vmin"], vmax=v["vmax"],
        extent=[x[0], x[-1], time[-1] * manifest["time"]["displayFactor"],
                time[0] * manifest["time"]["displayFactor"]],
        aspect="auto", interpolation="none",
    )
    ax2.invert_yaxis()
    ax2.set_xlim(x[0], x[-1])
    ax2.set_title("Wheeler diagram")
    ax2.set_ylabel(f"time ({manifest['time']['displayUnits']})")
    fig.colorbar(im, cax=cax)
    fig.savefig(QC_DIR / "wheeler1964_section_and_wheeler.png", dpi=150)
    plt.close("all")
    print("wheeler1964: section + Wheeler diagram rendered")


def qc_xes02():
    manifest, arrays, derived = load_bundle("xes02")
    topo, subsid = arrays["topo"], arrays["subsid"]
    time, sea_level = arrays["time"], arrays["seaLevel"]
    res = manifest["processing"]["resolution"]
    cmap = wheeler_cmap()

    # full pipeline on dequantized data, final datum
    topo_s = topo + (subsid[:, :, -1:] - subsid)
    strat, wheeler, wheeler_strat, vacuity = sg.create_wheeler_diagram(topo_s, res)

    # --- compare against the float64 reference saved by build_xes02 ---
    ref = np.load(QC_DIR / "xes02_reference.npz")
    sign_agree = float(np.mean(np.sign(wheeler) == np.sign(ref["wheeler"])))
    strat_err = float(np.nanmax(np.abs(strat - ref["strat"])))
    print(f"xes02: wheeler sign agreement (quantized vs float64) = {sign_agree:.4%}")
    print(f"xes02: max |strat - strat_ref| = {strat_err:.4f} mm")

    # --- dip and strike section Wheeler diagrams (paper Fig. 16) ---
    hours = time * manifest["time"]["displayFactor"]
    for name, sl, dx, loc in [
        ("dip", wheeler_strat[manifest["views"]["dipSection"]["defaultLoc"], :, :],
         manifest["space"]["spacing"][1], manifest["views"]["dipSection"]["defaultLoc"]),
        ("strike", wheeler_strat[:, manifest["views"]["strikeSection"]["defaultLoc"], :],
         manifest["space"]["spacing"][0], manifest["views"]["strikeSection"]["defaultLoc"]),
    ]:
        fig = plt.figure(figsize=(14, 9))
        spec = gridspec.GridSpec(ncols=2, nrows=1, width_ratios=[1, 6], wspace=0.04)
        ax0 = fig.add_subplot(spec[0])
        ax1 = fig.add_subplot(spec[1], sharey=ax0)
        im = ax1.imshow(
            sl.T, cmap=cmap, vmin=-10, vmax=10,
            extent=[0, dx * (sl.shape[0] - 1), hours[-1], 0],
            interpolation="none", aspect="auto",
        )
        ax1.invert_yaxis()
        ax0.plot(sea_level, hours, "k", linewidth=2)
        ax0.invert_xaxis()
        ax0.set_xlim(*manifest["views"]["seaLevelPlot"]["xlim"])
        ax0.set_ylim(0, hours[-1])
        ax0.set_ylabel("time (hours)")
        ax0.set_xlabel("base level (mm)")
        ax1.set_xlabel("distance (mm)")
        ax1.set_title(f"{name} section {loc}: Wheeler diagram")
        plt.setp(ax1.get_yticklabels(), visible=False)
        fig.colorbar(im, ax=ax1)
        fig.savefig(QC_DIR / f"xes02_wheeler_{name}_section.png", dpi=150)
        plt.close("all")

    # --- cross section: preserved stratigraphy, dip section (paper Fig. 16A top) ---
    loc = manifest["views"]["dipSection"]["defaultLoc"]
    dxc = manifest["space"]["spacing"][1]
    xsec = np.arange(strat.shape[1]) * dxc
    fig, ax = plt.subplots(figsize=(14, 5))
    cm_age = matplotlib.colormaps["viridis"]
    s = strat[loc, :, :]
    for i in range(0, s.shape[1] - 1):
        ax.fill(
            np.hstack((xsec, xsec[::-1])),
            np.hstack((s[:, i], s[:, i + 1][::-1])),
            facecolor=cm_age(i / (s.shape[1] - 2)), linewidth=0,
        )
    for i in range(0, s.shape[1], 24):
        ax.plot(xsec, s[:, i], "k", linewidth=0.3)
    ax.set_xlim(0, xsec[-1])
    ax.set_title(f"dip section {loc}: preserved stratigraphy colored by age")
    ax.set_xlabel("distance (mm)")
    ax.set_ylabel("elevation (mm)")
    fig.savefig(QC_DIR / "xes02_dip_section_strat.png", dpi=150)
    plt.close("all")

    # --- attribute maps from bundle derived/ vs recomputed from quantized arrays ---
    (dep_t, ero_t, sta_t, vac_t, dep_th, ero_th) = (
        derived["depositionTime"], derived["erosionTime"], derived["stasisTime"],
        derived["vacuityTime"], derived["depositionThickness"], derived["erosionThickness"],
    )
    maps_re = sg.compute_strat_maps(strat, wheeler, wheeler_strat, vacuity)
    max_map_err = max(
        float(np.nanmax(np.abs(a - b)))
        for a, b in zip(maps_re, [dep_t, ero_t, sta_t, vac_t, dep_th, ero_th])
    )
    print(f"xes02: max attribute-map diff (bundle derived vs quantized recompute) = {max_map_err:.4f}")

    import cmocean

    nrows, ncols = manifest["space"]["shape"]
    drow, dcol = manifest["space"]["spacing"]
    extent = [0, dcol * ncols, 0, drow * nrows]  # physical mm; equal aspect packs tightly
    fig, axs = plt.subplots(2, 3, sharey=True, figsize=(16, 5.2), layout="constrained")
    for ax, (name, m, vmin, vmax) in zip(
        axs.flat,
        [
            ("deposition (time)", dep_t, 0, 1),
            ("erosion (time)", ero_t, 0, 0.5),
            ("stasis (time)", sta_t, 0, 1),
            ("vacuity (time)", vac_t, 0, 0.5),
            ("deposition thickness", dep_th, None, None),
            ("erosion thickness", ero_th, None, None),
        ],
    ):
        mm = m.copy()
        mm[sta_t == 1] = np.nan  # blank 'uninteresting' areas, as in the notebook
        im = ax.imshow(mm, vmin=vmin, vmax=vmax, cmap=cmocean.cm.deep_r, extent=extent)
        ax.set_title(name)
        ax.set_xticks([])
        ax.set_yticks([])
        fig.colorbar(im, ax=ax, shrink=0.9)
    fig.savefig(QC_DIR / "xes02_strat_maps.png", dpi=150)
    plt.close("all")
    print("xes02: sections + maps rendered")


if __name__ == "__main__":
    qc_barrell()
    qc_wheeler1964()
    qc_xes02()
    print(f"\nQC figures written to {QC_DIR}")
