"""Add overhead-photo textures to the XES-02 bundle.

Follows the texture-draping cells of stratigraph/notebooks/Stratigraph_XES_02.ipynb
(Figs. 15/16): the time-lapse corrected overhead photos (900 x 500 px, one every
600 s) are draped on the 3D block diagram's top surface. The notebook establishes
the empirical photo-to-grid alignment via the resampled arrays
`resize(topo[:, :90], (500, 1010))[:, 5:-5]` — i.e. the first 90 columns
(x = 0..4450 mm) stretched to 1010 and trimmed to 1000 — with photo row i (after
vertical flip) = resampled row i and photo col p = resampled col p + 50. The
photo therefore covers x ~ 222..4228 mm at ~4.46 mm/px (the overhead camera did
not see the distal basin) and the full strike extent. This script bakes that
alignment offline so the app's mapping is trivial:

- each app time step k (hourly) gets the photo nearest in run time (<= 300 s off);
- the photo is warped (bilinear) onto a canvas covering the FULL grid-node extent
  x in [0, 5500] mm (dip), y in [0, 2600] mm (strike), row 0 = grid row 0, so the
  app's UVs are just u = x/5500, v = y/2600 regardless of the display crop;
- regions that are not photo coverage of sediment are neutral gray: the
  fix_corners plateau triangles (+2-cell dilation, matching gridClean's exempt
  shoulders — the photo only shows tank wall there, which draped purple), the
  proximal strip before photo coverage (x < ~222 mm, where edge replication
  smeared the inlet apparatus into black/white stripes), and any remaining
  outside-the-tank black; the distal ~1270 mm — permanently subaqueous deep
  basin the camera never saw — instead fades over ~150 mm into the photo's own
  median deep-water color;
- written as WebP, textures/step_{k}.webp, one per time step.

QC: warped photos with the topo-derived shoreline contour overlaid, to verify the
alignment visually (preprocessing/qc/xes02_photo_align_*.png).
"""

import glob
import json
import os

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
from scipy import ndimage

from common import APP_ROOT, DATA_ROOT, read_array

DATASET_ID = "xes02"
PHOTO_DIR = (
    "/Users/zoltan/Documents/Chronostratigraphy/XES_02/R02_1 Overhead Photos/"
    "time lapse corrected photos/all_photos"
)
QC_DIR = APP_ROOT / "preprocessing" / "qc"

# output canvas: full grid-node extent at ~5.4 mm/px
OUT_W, OUT_H = 1024, 484
EXTENT = [0.0, 5500.0, 0.0, 2600.0]  # x0, x1 (dip), y0, y1 (strike), mm
WEBP_QUALITY = 85

# notebook resampling (cell-center convention): 261 rows -> 500; cols 0..89
# (of 111) -> 1010, trimmed [5:-5] -> 1000. Photo row i (flipped) = resampled
# row i, photo col p = resampled col p + 50, so with the trim the photo col
# offset into the untrimmed 1010-wide frame is 55.
RS_ROWS = 500
RS_COLS_FULL = 1010  # before the [5:-5] trim
IN_COLS = 90         # original columns covered by the resample
COL_OFF = 55         # photo col 0 = untrimmed resampled col 55


def warp_photo(im):
    """Photo (500, 900, 3) -> (OUT_H, OUT_W, 3) canvas in grid coordinates."""
    imf = np.asarray(im, dtype=np.float32)[::-1, :, :]  # flip: row 0 = grid y 0
    i = np.arange(OUT_H)
    j = np.arange(OUT_W)
    y_mm = (i + 0.5) * (EXTENT[3] - EXTENT[2]) / OUT_H + EXTENT[2]
    x_mm = (j + 0.5) * (EXTENT[1] - EXTENT[0]) / OUT_W + EXTENT[0]
    # inverse of the cell-center resampling: grid node coord -> photo px coord
    rf = (y_mm / 10.0 + 0.5) * RS_ROWS / 261.0 - 0.5
    pf = (x_mm / 50.0 + 0.5) * RS_COLS_FULL / IN_COLS - 0.5 - COL_OFF
    RF, PF = np.meshgrid(rf, pf, indexing="ij")
    out = np.empty((OUT_H, OUT_W, 3), dtype=np.float32)
    for ch in range(3):
        # mode='nearest' clamps out-of-photo coords -> edge replication
        out[:, :, ch] = ndimage.map_coordinates(
            imf[:, :, ch], [RF, PF], order=1, mode="nearest"
        )
    return out


GRAY = 212.0


def shoulder_weight():
    """Blend weight (1 = gray) over the canvas: the fix_corners plateau
    triangles + 2-cell dilation (covering gridClean's exempt shoulders and the
    purple tank-wall band that would drape onto them), and the proximal strip
    left of photo coverage, blended over ~30 mm into the photo."""
    r_idx, c_idx = np.indices((261, 111))
    tri = (r_idx < -5.3 * c_idx + 125) | (r_idx > 5.3 * c_idx + 125)
    plus = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
    tri = ndimage.binary_dilation(tri, structure=plus, iterations=2)
    i = np.arange(OUT_H)
    j = np.arange(OUT_W)
    y = (i + 0.5) * (EXTENT[3] - EXTENT[2]) / OUT_H + EXTENT[2]
    x = (j + 0.5) * (EXTENT[1] - EXTENT[0]) / OUT_W + EXTENT[0]
    rr = np.clip(np.round(y / 10.0).astype(int), 0, 260)
    cc = np.clip(np.round(x / 50.0).astype(int), 0, 110)
    w = tri[np.ix_(rr, cc)].astype(np.float32)
    # proximal strip: gray left of the first photo column, ~30 mm blend after
    x_photo0 = 50.0 * ((COL_OFF + 0.5) * IN_COLS / RS_COLS_FULL - 0.5)
    BLEND_MM = 30.0
    t = np.clip((x_photo0 + BLEND_MM - x) / BLEND_MM, 0.0, 1.0)
    return np.maximum(w, t[None, :])


def fade_distal(out, imf):
    """Beyond the photo's distal edge: fade to the median deep-water color."""
    # median RGB of the photo's outermost valid columns (robust to artifacts)
    fill = np.median(imf[:, -20:, :], axis=(0, 1))
    x_edge = 50.0 * ((899 + COL_OFF + 0.5) * IN_COLS / RS_COLS_FULL - 0.5)
    j_edge = int(np.floor((x_edge / (EXTENT[1] - EXTENT[0])) * OUT_W - 0.5))
    FADE_MM = 150.0
    fade_px = max(1, int(round(FADE_MM / ((EXTENT[1] - EXTENT[0]) / OUT_W))))
    edge_col = out[:, j_edge, :].copy()
    for j in range(j_edge + 1, OUT_W):
        t = min(1.0, (j - j_edge) / fade_px)
        out[:, j, :] = (1 - t) * edge_col + t * fill
    return out


def fill_black_corners(out):
    """Outside-the-tank corners are black in the photos; fill with light gray."""
    dark = out.max(axis=2) < 30
    # only regions connected to the image border (never dark interior pixels)
    lab, n = ndimage.label(dark)
    border_labels = set(np.unique(lab[0, :])) | set(np.unique(lab[-1, :])) | set(
        np.unique(lab[:, 0])
    ) | set(np.unique(lab[:, -1]))
    border_labels.discard(0)
    mask = np.isin(lab, list(border_labels))
    # grow one px to swallow the dark antialiased rim
    mask = ndimage.binary_dilation(mask, iterations=2)
    out[mask] = GRAY
    return out


def main():
    bundle = DATA_ROOT / DATASET_ID
    manifest = json.load(open(bundle / "manifest.json"))
    time = read_array(bundle, manifest["arrays"]["time"])
    nt = manifest["time"]["n"]
    assert len(time) == nt

    fnames = sorted(glob.glob(os.path.join(PHOTO_DIR, "*.tif")))
    photo_times = np.array([int(os.path.basename(f)[8:15]) for f in fnames])
    print(f"{len(fnames)} photos, run time {photo_times.min()}-{photo_times.max()} s")

    tex_dir = bundle / "textures"
    tex_dir.mkdir(exist_ok=True)
    shoulder_w = shoulder_weight()
    total = 0
    max_dt = 0
    for k in range(nt):
        ind = int(np.argmin(np.abs(photo_times - time[k])))
        max_dt = max(max_dt, abs(photo_times[ind] - time[k]))
        im = Image.open(fnames[ind]).convert("RGB")
        imf = np.asarray(im, dtype=np.float32)
        out = fill_black_corners(fade_distal(warp_photo(im), imf))
        out = out * (1 - shoulder_w[:, :, None]) + GRAY * shoulder_w[:, :, None]
        img = Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))
        path = tex_dir / f"step_{k:03d}.webp"
        img.save(path, "WEBP", quality=WEBP_QUALITY, method=6)
        total += path.stat().st_size
        if k % 50 == 0:
            print(f"  step {k}: {os.path.basename(fnames[ind])} -> {path.name}")
    print(f"wrote {nt} textures, {total / 1e6:.1f} MB total, max time offset {max_dt:.0f} s")

    manifest["textures"] = {
        "overhead": {
            "pattern": "textures/step_{step}.webp",
            "stepPad": 3,
            "n": nt,
            "extent": EXTENT,
            "size": [OUT_W, OUT_H],
            "note": (
                "Time-lapse corrected overhead photos (XES-02, SAFL) warped to grid-"
                "node coordinates; row 0 = grid row 0 (strike y=0). UV: u=(x-x0)/"
                "(x1-x0), v=(y-y0)/(y1-y0). Corners outside the tank filled gray."
            ),
        }
    }
    with open(bundle / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print("manifest updated")

    # ---- QC: shoreline contour from topo overlaid on the warped photo ----
    topo = read_array(bundle, manifest["arrays"]["topo"])
    sl = read_array(bundle, manifest["arrays"]["seaLevel"])
    QC_DIR.mkdir(exist_ok=True)
    for k in [60, 100, 200, 310]:
        img = np.asarray(Image.open(tex_dir / f"step_{k:03d}.webp"))
        fig, ax = plt.subplots(figsize=(11, 5.5))
        ax.imshow(
            img,
            extent=[EXTENT[0], EXTENT[1], EXTENT[3], EXTENT[2]],  # row 0 at top = y0
            interpolation="bilinear",
        )
        x = np.arange(111) * 50.0
        y = np.arange(261) * 10.0
        ax.contour(x, y, topo[:, :, k], levels=[sl[k]], colors="red", linewidths=1.2)
        ax.set_title(f"step {k} (t = {time[k]/3600:.0f} h): photo vs shoreline (topo = sea level)")
        ax.set_xlabel("dip (mm)")
        ax.set_ylabel("strike (mm)")
        fig.tight_layout()
        fig.savefig(QC_DIR / f"xes02_photo_align_{k:03d}.png", dpi=110)
        plt.close(fig)
    print("QC figures in preprocessing/qc/")


if __name__ == "__main__":
    main()
