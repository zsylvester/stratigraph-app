"""Export reference slices from the float64 Python pipeline for validating the
TypeScript port (src/strat/validate.ts). Writes public/qc/*.bin + qc.json."""

import json
from pathlib import Path

import numpy as np

from common import APP_ROOT

QC_NPZ = APP_ROOT / "preprocessing" / "qc" / "xes02_reference.npz"
OUT = APP_ROOT / "public" / "qc"
DIP_LOC = 130

def main():
    ref = np.load(QC_NPZ)
    OUT.mkdir(parents=True, exist_ok=True)
    strat = ref["strat"][DIP_LOC].astype("<f4")          # (111, nt)
    wstrat = ref["wheeler_strat"][DIP_LOC].astype("<f4") # (111, nt-1)
    strat.tofile(OUT / "xes02_strat_dip130.bin")
    wstrat.tofile(OUT / "xes02_wheeler_strat_dip130.bin")
    (OUT / "qc.json").write_text(json.dumps({
        "dipLoc": DIP_LOC,
        "strat": {"path": "xes02_strat_dip130.bin", "shape": list(strat.shape)},
        "wheelerStrat": {"path": "xes02_wheeler_strat_dip130.bin", "shape": list(wstrat.shape)},
    }, indent=2))
    print(f"wrote reference slices for dip {DIP_LOC} to {OUT}")

if __name__ == "__main__":
    main()
