"""Shared utilities for building dataset bundles (see ../FORMAT.md).

Run all build scripts with the 'stratigraph' conda env:
    /Users/zoltan/miniforge3/envs/stratigraph/bin/python build_xxx.py
"""

import json
import os
from pathlib import Path

import numpy as np

APP_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = APP_ROOT / "public" / "data"
STRATIGRAPH_ROOT = Path(
    os.environ.get(
        "STRATIGRAPH_ROOT",
        APP_ROOT.parent / "stratigraph",
    )
)
STRATIGRAPH_DATA = STRATIGRAPH_ROOT / "data"

NAN_SENTINEL = -32768


def write_array(bundle_dir, rel_path, arr, dtype="float32", scale=None, offset=None):
    """Write an array as raw little-endian binary; return its manifest entry.

    dtype='int16' quantizes: value = raw * scale + offset. If scale is None it is
    chosen so the finite data range maps to ~64000 int16 steps. NaNs -> -32768.
    """
    arr = np.asarray(arr)
    out = bundle_dir / rel_path
    out.parent.mkdir(parents=True, exist_ok=True)
    entry = {"path": rel_path, "shape": list(arr.shape)}

    if dtype == "int16":
        finite = np.isfinite(arr)
        amin = float(arr[finite].min())
        amax = float(arr[finite].max())
        if offset is None:
            offset = 0.5 * (amin + amax)
        if scale is None:
            scale = max((amax - amin) / 64000.0, 1e-12)
        q = np.round((arr - offset) / scale)
        assert q[finite].min() >= -32767 and q[finite].max() <= 32767, (
            f"{rel_path}: quantized range exceeds int16"
        )
        q = np.where(finite, q, NAN_SENTINEL).astype("<i2")
        q.tofile(out)
        entry.update(dtype="int16", scale=scale, offset=offset, nan=NAN_SENTINEL)
        # max quantization error is scale/2 by construction
        entry["maxAbsError"] = scale / 2.0
    elif dtype in ("float32", "float64"):
        arr.astype("<f4" if dtype == "float32" else "<f8").tofile(out)
        entry["dtype"] = dtype
    else:
        raise ValueError(f"unsupported dtype {dtype}")
    return entry


def read_array(bundle_dir, entry):
    """Read an array back from its manifest entry (round-trip check / QC use)."""
    dt = {"int8": "i1", "int16": "<i2", "float32": "<f4", "float64": "<f8"}[entry["dtype"]]
    raw = np.fromfile(Path(bundle_dir) / entry["path"], dtype=dt)
    raw = raw.reshape(entry["shape"])
    if entry["dtype"] == "int16":
        a = raw.astype(np.float64) * entry["scale"] + entry["offset"]
        a[raw == entry["nan"]] = np.nan
        return a
    return raw.astype(np.float64)


def write_manifest(bundle_dir, manifest):
    with open(bundle_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)


def update_index(dataset_id, name, description):
    """Register the dataset in public/data/index.json (idempotent)."""
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    index_path = DATA_ROOT / "index.json"
    index = {"datasets": []}
    if index_path.exists():
        index = json.loads(index_path.read_text())
    index["datasets"] = [d for d in index["datasets"] if d["id"] != dataset_id]
    index["datasets"].append(
        {"id": dataset_id, "name": name, "description": description,
         "path": f"{dataset_id}/"}
    )
    index["datasets"].sort(key=lambda d: d["id"])
    index_path.write_text(json.dumps(index, indent=2))


def bundle_dir_for(dataset_id, wipe=False):
    d = DATA_ROOT / dataset_id
    if wipe and d.exists():
        import shutil

        shutil.rmtree(d)
    d.mkdir(parents=True, exist_ok=True)
    return d


def report(manifest):
    """Print a short summary of what was written."""
    total = 0
    for section in ("arrays", "derived"):
        for name, e in manifest.get(section, {}).items():
            p = DATA_ROOT / manifest["id"] / e["path"]
            kb = p.stat().st_size / 1024
            total += kb
            err = f", maxErr={e['maxAbsError']:.4g}" if "maxAbsError" in e else ""
            print(f"  {section}/{name:24s} {str(e['shape']):>18s} {e['dtype']:>8s} {kb:9.1f} KB{err}")
    print(f"  total: {total / 1024:.1f} MB")
