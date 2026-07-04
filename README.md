# Stratigraph — stratigraphy in space & time

Interactive web app for exploring stratigraphic models the way Sylvester, Straub &
Covault (2024, *Earth-Science Reviews* 250, 104706) does: a Barrell (time–elevation)
plot, dip/strike cross sections, a chronostratigraphic (Wheeler) diagram and a map
view, all linked through a shared time step. Datasets: Barrell's 1917 elevation
curve, the Wheeler 1964 diagram reconstruction, the XES-02 and TDWB-17-1 flume
experiments, and the meanderpy channel-belt model.

## Architecture

- **`preprocessing/`** — Python scripts (run with the `stratigraph` conda env) that
  turn raw data into static *bundles* under `public/data/` using the `stratigraph`
  package itself. See [preprocessing/README.md](preprocessing/README.md) and
  [FORMAT.md](FORMAT.md).
- **`src/`** — Vite + React + TypeScript single-page app. The stratigraphic core
  (`src/strat/core.ts`: retro-deformation, topostrat, Wheeler assembly) is a TS port
  validated against the Python pipeline (`src/strat/validate.ts`).
- No server: everything is static files + client-side computation.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/ (~47 MB, mostly data)
npm run preview    # serve dist/ locally
```

Keyboard: space = play/pause, ←/→ = step (shift = ×10). Views are shareable via the
URL hash (dataset, time step, section, probe, color mode).

## Deploying

`dist/` is fully self-contained with relative asset paths (`base: './'`), so it works
on any static host, including under a subpath:

- **Netlify / Cloudflare Pages**: drag-and-drop `dist/`, or connect the repo with
  build command `npm run build`, publish directory `dist`.
- **GitHub Pages**: push `dist/` to a `gh-pages` branch (or use an action). The
  relative base means no config needed for `user.github.io/repo/` URLs.

Enable gzip/brotli if the host allows (most do automatically): the binary bundles
compress roughly 2×. The `public/qc/` folder (~300 KB) is only used by the dev-time
validation and can be excluded from deployment.
