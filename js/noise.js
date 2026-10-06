//  seeded 2D simplex noise + fBm / ridged variants
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['noise'] = true;
export class Noise2D {
  constructor(seed = 1337) {
    this.p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    let s = (seed >>> 0) || 1;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
    this.grad = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  }

  noise(xin, yin) {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const p = this.p, g = this.grad;
    let n = 0, t0, gi;
    t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { t0 *= t0; gi = p[ii + p[jj]] & 7; n += t0 * t0 * (g[gi][0] * x0 + g[gi][1] * y0); }
    t0 = 0.5 - x1 * x1 - y1 * y1;
    if (t0 > 0) { t0 *= t0; gi = p[ii + i1 + p[jj + j1]] & 7; n += t0 * t0 * (g[gi][0] * x1 + g[gi][1] * y1); }
    t0 = 0.5 - x2 * x2 - y2 * y2;
    if (t0 > 0) { t0 *= t0; gi = p[ii + 1 + p[jj + 1]] & 7; n += t0 * t0 * (g[gi][0] * x2 + g[gi][1] * y2); }
    return 70 * n; // ~[-1,1]
  }

  fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp; amp *= gain; freq *= lac;
    }
    return sum / norm;
  }

  ridged(x, y, oct = 4, lac = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      const n = 1 - Math.abs(this.noise(x * freq, y * freq));
      sum += amp * n * n;
      norm += amp; amp *= gain; freq *= lac;
    }
    return sum / norm; // ~[0,1]
  }
}
