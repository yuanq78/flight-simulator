// Chunked procedural terrain + vegetation + water
import * as THREE from 'three';
import { Noise2D } from './noise.js';
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['terrain'] = true;

const CHUNK = 768;
const RES = 96;          // segments per chunk
const GRID_R = 2;        // chunks in each direction
const TREE_RADIUS = 5200;
const TREE_COUNT = 3200;
const ROCK_COUNT = 450;

export const SPAWN = { x: 0, z: 0, h: 130 };

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class Terrain {
  constructor(scene, seed) {
    this.scene = scene;
    this.noise = new Noise2D(seed);
    this.seed = seed;
    this.chunks = new Map();
    this.queue = [];
    this.center = { cx: 1e9, cz: 1e9 };

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0.0,
    });

    // ---- vegetation (instanced)
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.55, 3.2, 5);
    trunkGeo.translate(0, 1.6, 0);
    this.trunks = new THREE.InstancedMesh(trunkGeo,
      new THREE.MeshStandardMaterial({ roughness: 1 }), TREE_COUNT);
    const coneGeo1 = new THREE.ConeGeometry(3.1, 6.5, 7);
    coneGeo1.translate(0, 5.6, 0);
    const coneGeo2 = new THREE.ConeGeometry(2.1, 5.0, 7);
    coneGeo2.translate(0, 9.2, 0);
    this.cones1 = new THREE.InstancedMesh(coneGeo1,
      new THREE.MeshStandardMaterial({ roughness: 1 }), TREE_COUNT);
    this.cones2 = new THREE.InstancedMesh(coneGeo2,
      new THREE.MeshStandardMaterial({ roughness: 1 }), TREE_COUNT);
    for (const m of [this.trunks, this.cones1, this.cones2]) {
      m.castShadow = true; m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
    this.treeCenter = { x: 1e9, z: 1e9 };

    // ---- rocks
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    this.rocks = new THREE.InstancedMesh(rockGeo,
      new THREE.MeshStandardMaterial({ roughness: 1, color: 0x8a8a8f }), ROCK_COUNT);
    this.rocks.castShadow = true;
    this.rocks.frustumCulled = false;
    scene.add(this.rocks);

    // ---- water
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
        uDeep: { value: new THREE.Color(0.012, 0.05, 0.10) },
        uShallow: { value: new THREE.Color(0.05, 0.22, 0.30) },
        uSky: { value: new THREE.Color(0.55, 0.65, 0.75) },
        uFogColor: { value: new THREE.Color(0.6, 0.65, 0.7) },
        uFogNear: { value: 2500 },
        uFogFar: { value: 26000 },
        uNoise: { value: makeNoiseTexture() },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir, uSunColor, uDeep, uShallow, uSky, uFogColor;
        uniform float uFogNear, uFogFar;
        uniform sampler2D uNoise;
        varying vec3 vWorld;
        void main() {
          vec2 uv1 = vWorld.xz * 0.018 + uTime * vec2(0.011, 0.007);
          vec2 uv2 = vWorld.xz * 0.052 - uTime * vec2(0.017, 0.011);
          float n1 = texture2D(uNoise, uv1).r;
          float n2 = texture2D(uNoise, uv2).r;
          vec3 N = normalize(vec3((n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.45, 1.0,
                                 (n2 - 0.5) * 0.55 - (n1 - 0.5) * 0.45));
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 col = mix(uDeep, uShallow, clamp(fres * 0.7 + n1 * 0.2, 0.0, 1.0));
          col = mix(col, uSky, clamp(fres * 0.6, 0.0, 1.0));
          vec3 H = normalize(V + uSunDir);
          float spec = pow(max(dot(N, H), 0.0), 240.0) * 2.2;
          col += uSunColor * spec;
          float d = distance(cameraPosition, vWorld);
          float f = smoothstep(uFogNear, uFogFar, d);
          col = mix(col, uFogColor, f);
          gl_FragColor = vec4(col, 0.94);
        }`,
    });
    const waterGeo = new THREE.PlaneGeometry(90000, 90000, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(waterGeo, this.waterMat);
    this.water.frustumCulled = false;
    scene.add(this.water);
  }

  // ------- pure height field (shared by mesh + physics) -------
  height(x, z) {
    const n = this.noise;
    const m = n.ridged(x * 0.00042, z * 0.00042, 5);
    const mountains = Math.pow(m, 1.7) * 2150;
    const hills = n.fbm(x * 0.0016, z * 0.0016, 4) * 270;
    const detail = n.fbm(x * 0.008, z * 0.008, 3) * 24;
    const micro = n.fbm(x * 0.03, z * 0.03, 2) * 3.5;
    let h = mountains + hills + detail + micro - 140;
    // gentle flatten near spawn
    const dS = Math.hypot(x - SPAWN.x, z - SPAWN.z);
    if (dS < 1600) {
      const t = smoothstep(1600, 350, dS) * 0.92;
      h = h + (SPAWN.h - h) * t;
    }
    // grass runway strip (north of spawn)
    const dx = x - SPAWN.x, dz = z - SPAWN.z;
    if (dz < 160 && dz > -980 && Math.abs(dx) < 130) {
      const edge = smoothstep(130, 70, Math.abs(dx)) * smoothstep(-980, -920, dz) * smoothstep(160, 100, dz);
      h = h + (SPAWN.h - h) * edge;
    }
    // 北向起飞走廊：跑道延长线上的低地谷地（半宽 250m 全强 / 600m 渐零），
    // 保证按跑道航向起飞爬升不会撞上北面山墙；远处谷底缓缓抬升
    if (dz < 160) {
      const corr = smoothstep(600, 250, Math.abs(dx)) * smoothstep(160, 0, dz);
      if (corr > 0) {
        const valley = SPAWN.h + Math.max(0, -dz) * 0.012;
        h = h + (valley - h) * corr * 0.92;
      }
    }
    return h;
  }

  moisture(x, z) {
    return this.noise.fbm(x * 0.0021 + 500, z * 0.0021 - 300, 3);
  }

  slopeAt(x, z) {
    const e = 6;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  // ------- chunk mesh -------
  buildChunk(cx, cz) {
    const key = cx + ',' + cz;
    if (this.chunks.has(key)) return;
    const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, RES, RES);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const heights = new Float32Array(count);
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const step = CHUNK / RES;

    for (let i = 0; i < count; i++) {
      const x = ox + pos.getX(i);
      const z = oz + pos.getZ(i);
      const h = this.height(x, z);
      pos.setY(i, h);
      heights[i] = h;
    }
    // colors with neighbor-based slope
    const W = RES + 1;
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const ix = i % W, iz = (i / W) | 0;
      const h = heights[i];
      const hx = heights[Math.min(ix + 1, RES) + iz * W] - heights[Math.max(ix - 1, 0) + iz * W];
      const hz = heights[ix + Math.min(iz + 1, RES) * W] - heights[ix + Math.max(iz - 1, 0) * W];
      const slope = Math.hypot(hx, hz) / (2 * step);
      const x = ox + pos.getX(i);
      const z = oz + pos.getZ(i);
      const moist = this.moisture(x, z);
      this.paintColor(col, h, slope, moist, x, z);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.chunks.set(key, mesh);
  }

  paintColor(col, h, slope, moist, x, z) {
    const n = this.noise;
    // base grass: mix of meadow green tones
    const g1 = 0.32 + moist * 0.16;          // green channel base
    const dry = n.fbm(x * 0.004 + 90, z * 0.004, 2) * 0.5 + 0.5;
    let r = 0.24 + dry * 0.14, g = g1, b = 0.10 + moist * 0.05;
    // forest: darker, richer green
    const forest = smoothstep(0.12, 0.45, moist) * smoothstep(1500, 900, h);
    r = r + (0.05 - r) * forest;
    g = g + (0.42 - g) * forest;
    b = b + (0.08 - b) * forest;
    // rock
    const rock = smoothstep(0.55, 0.9, slope);
    r = r + (0.42 - r) * rock;
    g = g + (0.41 - g) * rock;
    b = b + (0.38 - b) * rock;
    // scree / high altitude rock
    const high = smoothstep(900, 1600, h) * (1 - rock) * 0.6;
    r = r + (0.38 - r) * high;
    g = g + (0.36 - g) * high;
    b = b + (0.33 - b) * high;
    // snow
    const snowline = 1450 + n.noise(x * 0.001, z * 0.001) * 220;
    const snow = smoothstep(snowline, snowline + 180, h) * (1 - smoothstep(1.1, 1.8, slope));
    r = r + (0.93 - r) * snow;
    g = g + (0.95 - g) * snow;
    b = b + (0.98 - b) * snow;
    // sand near water
    const sand = smoothstep(4.5, 0.8, h) * smoothstep(-3, 0.5, h);
    r = r + (0.76 - r) * sand;
    g = g + (0.70 - g) * sand;
    b = b + (0.50 - b) * sand;
    // lake bed
    const bed = smoothstep(-1, -6, h);
    r = r + (0.35 - r) * bed;
    g = g + (0.33 - g) * bed;
    b = b + (0.24 - b) * bed;
    // runway strip: mowed grass + white dashes
    const dx = x - SPAWN.x, dz = z - SPAWN.z;
    if (dz < 160 && dz > -980 && Math.abs(dx) < 60) {
      const inStrip = smoothstep(60, 40, Math.abs(dx));
      r = r + (0.30 - r) * inStrip;
      g = g + (0.42 - g) * inStrip;
      b = b + (0.18 - b) * inStrip;
      // centerline dashes
      const dash = Math.abs(((dz + 980) % 40) - 20) < 4 ? 1 : 0;
      const line = smoothstep(3.5, 1.5, Math.abs(dx)) * dash * inStrip;
      r = r + (0.9 - r) * line;
      g = g + (0.9 - g) * line;
      b = b + (0.9 - b) * line;
    }
    col.setRGB(r, g, b);
  }

  update(camX, camZ) {
    const cx = Math.floor(camX / CHUNK), cz = Math.floor(camZ / CHUNK);
    if (cx !== this.center.cx || cz !== this.center.cz) {
      this.center.cx = cx; this.center.cz = cz;
      this.queue.length = 0;
      for (let dx = -GRID_R; dx <= GRID_R; dx++)
        for (let dz = -GRID_R; dz <= GRID_R; dz++)
          this.queue.push([cx + dx, cz + dz]);
      // drop far chunks
      for (const [key, mesh] of this.chunks) {
        const [kx, kz] = key.split(',').map(Number);
        if (Math.abs(kx - cx) > GRID_R + 1 || Math.abs(kz - cz) > GRID_R + 1) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          this.chunks.delete(key);
        }
      }
    }
    // build a couple of queued chunks per frame to avoid hitches
    let built = 0;
    while (this.queue.length && built < 2) {
      const [qx, qz] = this.queue.shift();
      this.buildChunk(qx, qz);
      built++;
    }

    // water follows camera
    this.water.position.set(Math.round(camX / 100) * 100, 0, Math.round(camZ / 100) * 100);

    // vegetation regen
    if (Math.hypot(camX - this.treeCenter.x, camZ - this.treeCenter.z) > 300) {
      this.treeCenter.x = camX; this.treeCenter.z = camZ;
      this.scatterVegetation(camX, camZ);
    }
  }

  scatterVegetation(camX, camZ) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const eul = new THREE.Euler();
    const col = new THREE.Color();
    let ti = 0;
    let guard = 0;
    while (ti < TREE_COUNT && guard++ < TREE_COUNT * 12) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * TREE_RADIUS;
      const x = camX + Math.cos(ang) * rad;
      const z = camZ + Math.sin(ang) * rad;
      const h = this.height(x, z);
      if (h < 3 || h > 1500) continue;
      if (this.slopeAt(x, z) > 0.55) continue;
      if (this.moisture(x, z) < 0.05) continue;
      // avoid runway
      const dx = x - SPAWN.x, dz = z - SPAWN.z;
      if (dz < 200 && dz > -1050 && Math.abs(dx) < 90) continue;
      const sc = 0.7 + Math.random() * 1.1;
      eul.set(0, Math.random() * Math.PI * 2, 0);
      q.setFromEuler(eul);
      s.set(sc, sc * (0.85 + Math.random() * 0.4), sc);
      p.set(x, h - 0.2, z);
      m4.compose(p, q, s);
      this.trunks.setMatrixAt(ti, m4);
      this.cones1.setMatrixAt(ti, m4);
      this.cones2.setMatrixAt(ti, m4);
      const shade = 0.75 + Math.random() * 0.45;
      col.setRGB(0.16 * shade, 0.30 * shade, 0.13 * shade);
      this.cones1.setColorAt(ti, col);
      col.setRGB(0.20 * shade, 0.36 * shade, 0.16 * shade);
      this.cones2.setColorAt(ti, col);
      col.setRGB(0.24, 0.16, 0.10);
      this.trunks.setColorAt(ti, col);
      ti++;
    }
    this.trunks.count = this.cones1.count = this.cones2.count = ti;
    this.trunks.instanceMatrix.needsUpdate = true;
    this.cones1.instanceMatrix.needsUpdate = true;
    this.cones2.instanceMatrix.needsUpdate = true;
    if (this.trunks.instanceColor) this.trunks.instanceColor.needsUpdate = true;
    if (this.cones1.instanceColor) this.cones1.instanceColor.needsUpdate = true;
    if (this.cones2.instanceColor) this.cones2.instanceColor.needsUpdate = true;

    // rocks
    let ri = 0; guard = 0;
    while (ri < ROCK_COUNT && guard++ < ROCK_COUNT * 15) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * TREE_RADIUS;
      const x = camX + Math.cos(ang) * rad;
      const z = camZ + Math.sin(ang) * rad;
      const h = this.height(x, z);
      const slope = this.slopeAt(x, z);
      if (h < 1 || slope < 0.35) continue;
      const sc = 1 + Math.random() * 4.5;
      eul.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      q.setFromEuler(eul);
      s.set(sc, sc * (0.5 + Math.random() * 0.6), sc);
      p.set(x, h + sc * 0.1, z);
      m4.compose(p, q, s);
      this.rocks.setMatrixAt(ri, m4);
      ri++;
    }
    this.rocks.count = ri;
    this.rocks.instanceMatrix.needsUpdate = true;
  }

  setWaterUniforms(sunDir, sunColor, skyColor, fogColor, fogNear, fogFar) {
    const u = this.waterMat.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor);
    u.uSky.value.copy(skyColor);
    u.uFogColor.value.copy(fogColor);
    u.uFogNear.value = fogNear;
    u.uFogFar.value = fogFar;
  }

  dispose() {
    for (const [, mesh] of this.chunks) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunks.clear();
  }
}

function makeNoiseTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const noise = new Noise2D(777);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // tileable-ish: blend 4 samples
      const v = 0.5 + 0.5 * noise.fbm(x * 0.06, y * 0.06, 4);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
