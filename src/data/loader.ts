/** Fetches dataset bundles (manifest + raw binary arrays) per FORMAT.md. */

import { NdArray, type TypedData } from './ndarray'
import type { ArrayEntry, DatasetIndex, Manifest } from './types'

const BASE = `${import.meta.env.BASE_URL}data/`

export async function fetchIndex(): Promise<DatasetIndex> {
  const r = await fetch(`${BASE}index.json`)
  if (!r.ok) throw new Error(`failed to load dataset index: ${r.status}`)
  return r.json()
}

async function fetchManifest(datasetId: string): Promise<Manifest> {
  const r = await fetch(`${BASE}${datasetId}/manifest.json`)
  if (!r.ok) throw new Error(`failed to load manifest for ${datasetId}: ${r.status}`)
  return r.json()
}

function decode(buf: ArrayBuffer, entry: ArrayEntry): NdArray {
  let data: TypedData
  switch (entry.dtype) {
    case 'float64':
      data = new Float64Array(buf)
      break
    case 'float32':
      data = new Float32Array(buf)
      break
    case 'int8':
      data = new Int8Array(buf)
      break
    case 'int16': {
      // dequantize once at load: value = raw * scale + offset, sentinel -> NaN
      const raw = new Int16Array(buf)
      const out = new Float32Array(raw.length)
      const { scale = 1, offset = 0, nan } = entry
      for (let i = 0; i < raw.length; i++) {
        out[i] = raw[i] === nan ? NaN : raw[i] * scale + offset
      }
      data = out
      break
    }
  }
  return new NdArray(data, entry.shape)
}

/** A loaded dataset: manifest plus lazily-fetched, cached arrays. */
export class Dataset {
  readonly manifest: Manifest
  private base: string
  private cache = new Map<string, Promise<NdArray>>()

  constructor(manifest: Manifest, base: string) {
    this.manifest = manifest
    this.base = base
  }

  private entry(name: string): ArrayEntry {
    const e = this.manifest.arrays[name] ?? this.manifest.derived?.[name]
    if (!e) throw new Error(`${this.manifest.id}: no array named '${name}'`)
    return e
  }

  /** Lazily fetch + decode an array (from `arrays` or `derived`); cached. */
  array(name: string): Promise<NdArray> {
    let p = this.cache.get(name)
    if (!p) {
      const e = this.entry(name)
      p = fetch(this.base + e.path)
        .then((r) => {
          if (!r.ok) throw new Error(`failed to fetch ${e.path}: ${r.status}`)
          return r.arrayBuffer()
        })
        .then((buf) => decode(buf, e))
      this.cache.set(name, p)
      // let a failed fetch be retried
      p.catch(() => this.cache.delete(name))
    }
    return p
  }

  /** Total download size (bytes) of the named arrays, for progress display. */
  byteSize(names: string[]): number {
    const bytes = { int8: 1, int16: 2, float32: 4, float64: 8 }
    return names.reduce((sum, n) => {
      const e = this.entry(n)
      return sum + e.shape.reduce((a, b) => a * b, 1) * bytes[e.dtype]
    }, 0)
  }
}

const datasetCache = new Map<string, Promise<Dataset>>()

export function loadDataset(datasetId: string): Promise<Dataset> {
  let p = datasetCache.get(datasetId)
  if (!p) {
    p = fetchManifest(datasetId).then((m) => new Dataset(m, `${BASE}${datasetId}/`))
    datasetCache.set(datasetId, p)
    p.catch(() => datasetCache.delete(datasetId))
  }
  return p
}
