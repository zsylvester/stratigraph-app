/** Minimal n-dimensional array view over a flat typed array (C-order). */

export type TypedData = Float32Array | Float64Array | Int8Array

export class NdArray {
  readonly data: TypedData
  readonly shape: number[]
  readonly strides: number[]

  constructor(data: TypedData, shape: number[]) {
    const n = shape.reduce((a, b) => a * b, 1)
    if (n !== data.length) {
      throw new Error(`shape ${shape} does not match data length ${data.length}`)
    }
    this.data = data
    this.shape = shape
    this.strides = shape.map((_, i) => shape.slice(i + 1).reduce((a, b) => a * b, 1))
  }

  get(...idx: number[]): number {
    let off = 0
    for (let i = 0; i < idx.length; i++) off += idx[i] * this.strides[i]
    return this.data[off]
  }

  /**
   * Contiguous subarray at a leading index: for shape (a, b, c), pick(i) is the
   * (b, c) block. Zero-copy.
   */
  pick(i: number): NdArray {
    const sub = this.shape.slice(1)
    const size = this.strides[0]
    return new NdArray(this.data.subarray(i * size, (i + 1) * size) as TypedData, sub)
  }
}
