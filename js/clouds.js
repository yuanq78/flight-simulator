// Clouds (sprite-based), rain, lightning
import * as THREE from 'three';
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['clouds'] = true;

const WRAP = 26000;

export const WEATHER = {
  clear:    { cumulus: 9,  layer: 0,  fogNear: 4500, fogFar: 34000, wind: 3,  gust: 0.8, sunDim: 1.0,  turb: 2,   rain: false, lightning: false, cloudDark: 0 },
  fair:     { cumulus: 24, layer: 0,  fogNear: 3200, fogFar: 25000, wind: 5,  gust: 1.4, sunDim: 0.97, turb: 2,   rain: false, lightning: false, cloudDark: 0 },
  overcast: { cumulus: 10, layer: 60, fogNear: 800,  fogFar: 9000,  wind: 7,  gust: 2.2, sunDim: 0.34, turb: 3,   rain: false, lightning: false, cloudDark: 0.55 },
  storm:    { cumulus: 12, layer: 45, fogNear: 450,  fogFar: 6500,  wind: 17, gust: 7.0, sunDim: 0.16, turb: 5,   rain: true,  lightning: true,  cloudDark: 0.75 },
};

export class Clouds {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.textures = [];
    for (let i = 0; i < 6; i++) this.textures.push(makePuffTexture(i * 13 + 1));
    this.clouds = [];
    this.mode = 'clear';
    this.windDir = Math.random() * Math.PI * 2;

    // ---- rain
    const N = 2400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 150;
      pos[i * 3 + 1] = Math.random() * 90;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 150;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMat = new THREE.PointsMaterial({
      size: 1.5, map: makeStreakTexture(), transparent: true, opacity: 0.0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      color: 0xaFC4d8,
    });
    this.rain = new THREE.Points(geo, this.rainMat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    this.rainCount = N;

    this.flash = 0;
    this.nextBolt = 4;
    this.thunderPending = [];
  }

  setWeather(mode) {
    this.mode = mode;
    const w = WEATHER[mode];
    // clear old
    for (const c of this.clouds) {
      for (const s of c.sprites) {
        this.group.remove(s);
        s.material.dispose();
      }
    }
    this.clouds.length = 0;
    const dark = w.cloudDark;

    // cumulus clusters
    for (let i = 0; i < w.cumulus; i++) {
      const cx = (Math.random() - 0.5) * WRAP * 1.6;
      const cz = (Math.random() - 0.5) * WRAP * 1.6;
      const cy = 1250 + Math.random() * 1100;
      const puffs = 4 + (Math.random() * 5 | 0);
      const cloud = { sprites: [], drift: 0.8 + Math.random() * 0.6 };
      for (let p = 0; p < puffs; p++) {
        const mat = new THREE.SpriteMaterial({
          map: this.textures[(Math.random() * this.textures.length) | 0],
          transparent: true, depthWrite: false,
          opacity: 0.82,
          color: new THREE.Color(1 - dark * 0.75, 1 - dark * 0.75, 1 - dark * 0.65),
          fog: true,
        });
        const s = new THREE.Sprite(mat);
        const sc = 180 + Math.random() * 260;
        s.scale.set(sc, sc * 0.62, 1);
        s.position.set(
          cx + (Math.random() - 0.5) * 420,
          cy + (Math.random() - 0.5) * 130,
          cz + (Math.random() - 0.5) * 420
        );
        this.group.add(s);
        cloud.sprites.push(s);
      }
      this.clouds.push(cloud);
    }
    // overcast layer
    for (let i = 0; i < w.layer; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.textures[(Math.random() * this.textures.length) | 0],
        transparent: true, depthWrite: false,
        opacity: 0.9,
        color: new THREE.Color(1 - dark * 0.8, 1 - dark * 0.8, 1 - dark * 0.72),
        fog: true,
      });
      const s = new THREE.Sprite(mat);
      const sc = 900 + Math.random() * 1400;
      s.scale.set(sc, sc * 0.28, 1);
      s.position.set(
        (Math.random() - 0.5) * WRAP * 1.8,
        950 + Math.random() * 350,
        (Math.random() - 0.5) * WRAP * 1.8
      );
      this.group.add(s);
      this.clouds.push({ sprites: [s], drift: 1.0 + Math.random() * 0.8 });
    }
  }

  update(dt, camPos, time, audio) {
    const w = WEATHER[this.mode];
    // wind vector (FROM meteorological direction)
    const wd = this.windDir;
    const base = w.wind;
    this.windX = -Math.sin(wd) * base;
    this.windZ = Math.cos(wd) * base;

    // clouds drift & wrap
    for (const c of this.clouds) {
      for (const s of c.sprites) {
        s.position.x += this.windX * c.drift * dt;
        s.position.z += this.windZ * c.drift * dt;
        // wrap around camera
        let dx = s.position.x - camPos.x;
        let dz = s.position.z - camPos.z;
        if (dx > WRAP) s.position.x -= WRAP * 2;
        else if (dx < -WRAP) s.position.x += WRAP * 2;
        if (dz > WRAP) s.position.z -= WRAP * 2;
        else if (dz < -WRAP) s.position.z += WRAP * 2;
      }
    }

    // rain
    const targetOp = w.rain ? 0.4 : 0;
    this.rainMat.opacity += (targetOp - this.rainMat.opacity) * Math.min(1, dt * 2);
    if (this.rainMat.opacity > 0.01) {
      const p = this.rain.geometry.attributes.position;
      const arr = p.array;
      const slant = 0.35;
      for (let i = 0; i < this.rainCount; i++) {
        arr[i * 3 + 1] -= 62 * dt;
        arr[i * 3] += this.windX * slant * dt;
        arr[i * 3 + 2] += this.windZ * slant * dt;
        // wrap in camera-local box
        if (arr[i * 3 + 1] < -5) arr[i * 3 + 1] += 95;
        const rx = arr[i * 3] - (camPos.x - this.rain.position.x);
        const rz = arr[i * 3 + 2] - (camPos.z - this.rain.position.z);
        if (rx > 75) arr[i * 3] -= 150; else if (rx < -75) arr[i * 3] += 150;
        if (rz > 75) arr[i * 3 + 2] -= 150; else if (rz < -75) arr[i * 3 + 2] += 150;
      }
      p.needsUpdate = true;
      this.rain.position.set(camPos.x, camPos.y + 30, camPos.z);
    }

    // lightning
    this.flash *= Math.exp(-dt * 7);
    if (w.lightning) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 3 + Math.random() * 9;
        this.flash = 0.7 + Math.random() * 0.5;
        const delay = 1.2 + Math.random() * 4;
        if (audio) audio.thunder(delay);
      }
    }
    return this.flash;
  }

  // gusty wind (for physics): base + turbulence gusts
  gustWind(time, out) {
    const w = WEATHER[this.mode];
    const g = w.gust;
    out.x = this.windX + g * (Math.sin(time * 0.9) * 0.6 + Math.sin(time * 2.3 + 1.7) * 0.4);
    out.z = this.windZ + g * (Math.cos(time * 0.7 + 0.5) * 0.6 + Math.sin(time * 1.9) * 0.4);
    out.y = g * 0.35 * Math.sin(time * 1.3 + 2.0);
    return out;
  }

  nearestCloudDist(pos) {
    let best = 1e9;
    for (const c of this.clouds) {
      for (const s of c.sprites) {
        const d = s.position.distanceTo(pos);
        if (d < best) best = d;
      }
    }
    return best;
  }

  dispose() {
    this.setWeather('clear');
    this.rain.geometry.dispose();
    this.rainMat.dispose();
  }
}

function makePuffTexture(seed) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  let s = seed * 99991 + 7;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // several soft blobs
  for (let i = 0; i < 16; i++) {
    const x = size / 2 + (rand() - 0.5) * size * 0.55;
    const y = size / 2 + (rand() - 0.5) * size * 0.34;
    const r = size * (0.10 + rand() * 0.20);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.16 + rand() * 0.2;
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.6, `rgba(255,255,255,${a * 0.5})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  // darker bottom shading
  const shade = ctx.createLinearGradient(0, size * 0.45, 0, size);
  shade.addColorStop(0, 'rgba(90,100,120,0)');
  shade.addColorStop(1, 'rgba(70,80,100,0.22)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  // mask to soft circle
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.75, 'rgba(0,0,0,0.85)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStreakTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(6, 0, 4, 64);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}
