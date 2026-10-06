// Main orchestration: loop, state machine, cameras, effects
import * as THREE from 'three';
import { Aircraft } from './physics.js';
import { Terrain, SPAWN } from './terrain.js';
import { Sky } from './sky.js';
import { Clouds, WEATHER } from './clouds.js';
import { AircraftModel } from './aircraft.js';
import { HUD, Minimap } from './hud.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['main'] = true;

const FIXED_DT = 1 / 120;
const CAMPAIGNS = ['chase', 'cockpit', 'orbit'];

// ---------- explosion particles ----------
class Explosion {
  constructor(scene) {
    const N = 420;
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({
      size: 2.2, vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.life = 0;
    this.light = new THREE.PointLight(0xffaa55, 0, 900, 1.8);
    scene.add(this.light);
  }
  trigger(p, water = false) {
    this.life = water ? 0.9 : 1.6;
    this.maxLife = this.life;
    for (let i = 0; i < this.N; i++) {
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      const sp = (water ? 18 : 42) * (0.3 + Math.random());
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * (water ? 1.2 : 0.8) + 6;
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      const hot = Math.random();
      if (water) {
        this.col[i * 3] = 0.75; this.col[i * 3 + 1] = 0.85; this.col[i * 3 + 2] = 1.0;
      } else {
        this.col[i * 3] = 1.0;
        this.col[i * 3 + 1] = 0.35 + hot * 0.5;
        this.col[i * 3 + 2] = 0.08 + hot * 0.25;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.mat.opacity = 1;
    this.light.position.copy(p);
    this.light.intensity = water ? 4000 : 30000;
  }
  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    const drag = Math.max(0, 1 - dt * 1.4);
    for (let i = 0; i < this.N; i++) {
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - (this.maxLife > 1.2 ? 14 : 22) * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    const f = Math.max(0, this.life / this.maxLife);
    this.mat.opacity = f;
    this.light.intensity *= Math.max(0, 1 - dt * 5);
  }
}

// ---------- boot ----------
const diag = window.__diag || function () {};
diag('main-top');

const canvasHost = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
diag('renderer-ok');
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9db3c8, 3000, 25000);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.15, 90000);

const aircraft = new Aircraft();
diag('physics-ok');
const terrain = new Terrain(scene, 20240101);
diag('terrain-ok');
const sky = new Sky(scene, renderer);
diag('sky-ok');
const clouds = new Clouds(scene);
diag('clouds-ok');
const model = new AircraftModel(scene);
diag('model-ok');
const hud = new HUD(document.getElementById('hud'));
const minimap = new Minimap(document.getElementById('minimap'), terrain);
diag('hud-ok');
const audio = new AudioSys();
const input = new Input(renderer.domElement);
const explosion = new Explosion(scene);
diag('io-ok');

clouds.setWeather('clear');

// ---------- state ----------
let state = 'title';           // title | flying | paused | crashed
let simHour = 9;
let timeScale = 1;
let weatherMode = 'clear';
let cameraMode = 'chase';
let headYaw = 0, headPitch = 0;
let orbitYaw = 0.6, orbitPitch = -0.25, orbitDist = 26;
let titleOrbit = 0;
let simTime = 0;
let acc = 0;
let vsi = 0, prevAlt = 0;
let fps = 60, fpsT = 0, fpsN = 0;
let crashTimer = -1;
let telemetryOn = false;
let hintShown = false;
let loadingHidden = false;
const wind = new THREE.Vector3();
const gustWind = new THREE.Vector3();

// ---------- options UI ----------
const $ = (id) => document.getElementById(id);
const opts = { seed: 20240101, paint: 0 };

function segInit(id, cb) {
  const el = $(id);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [...el.children].forEach((c) => c.classList.remove('on'));
    b.classList.add('on');
    cb(b);
  });
}
segInit('optWeather', (b) => { weatherMode = b.dataset.w; });
segInit('optPaint', (b) => { opts.paint = +b.dataset.p; model.setPaint(opts.paint); });
segInit('pauseWeather', (b) => { weatherMode = b.dataset.w; applyWeather(); });
segInit('timeScale', (b) => { timeScale = +b.dataset.t; });

$('optTime').addEventListener('input', (e) => {
  const v = +e.target.value;
  simHour = v;
  $('optTimeVal').textContent = String(Math.floor(v)).padStart(2, '0') + ':' +
    String(Math.round((v % 1) * 60)).padStart(2, '0');
});

$('optInvPitch').addEventListener('change', (e) => {
  input.invertPitch = e.target.checked;
});

function applyWeather() {
  clouds.setWeather(weatherMode);
  const w = WEATHER[weatherMode];
  scene.fog.near = w.fogNear;
  scene.fog.far = w.fogFar;
  // sync title/pause buttons
  const sync = (id) => {
    [...$(id).children].forEach((c) => c.classList.toggle('on', c.dataset.w === weatherMode));
  };
  sync('pauseWeather');
}

function startFlight() {
  opts.seed = Math.max(1, Math.min(99999999, +$('optSeed').value || 1));
  terrain.dispose();
  terrain.seed = opts.seed;
}

function resetFlight() {
  // 出生在跑道南端全平段（z≤100 地形恰为 130m）、机轮刚好触地；机头朝北，前方跑道约 1000m
  const sx = SPAWN.x, sz = SPAWN.z + 90;
  const gh = terrain.height(sx, sz);
  aircraft.reset(sx, gh + 1.329, sz, 0);  // 略低于机轮夹值(1.33)，第一步即触地，避免微下坠产生假失速
  input.throttle = 0;
  simTime = 0;
  vsi = 0; prevAlt = aircraft.pos.y;
  headYaw = 0; headPitch = 0;
  explosion.life = 0;
  explosion.mat.opacity = 0;
  explosion.light.intensity = 0;
  model.setPaint(opts.paint);
}

function setWeatherMode(m) {
  weatherMode = m;
  applyWeather();
}

function setState(s) {
  state = s;
  $('titleScreen').classList.toggle('hidden', s !== 'title');
  $('pauseMenu').classList.toggle('hidden', s !== 'paused');
  $('crashScreen').classList.toggle('hidden', s !== 'crashed' || crashTimer > 0);
  $('loading').classList.add('done');
}

// ---------- UI wiring ----------
$('startBtn').addEventListener('click', async () => {
  audio.init();
  simHour = +$('optTime').value || 9;
  // rebuild terrain with chosen seed
  const seed = Math.max(1, Math.min(99999999, +$('optSeed').value || 1));
  opts.seed = seed;
  terrain.dispose();
  terrain.noise = new (await import('./noise.js')).Noise2D(seed);
  terrain.center.cx = 1e9; terrain.treeCenter.x = 1e9;
  applyWeather();
  model.setPaint(opts.paint);
  resetFlight();
  setState('flying');
  if (!hintShown) { hud.showHint(); hintShown = true; }
});
$('resumeBtn').addEventListener('click', () => setState('flying'));
$('restartBtn').addEventListener('click', () => { resetFlight(); setState('flying'); });
$('quitBtn').addEventListener('click', () => setState('title'));
$('retryBtn').addEventListener('click', () => { resetFlight(); setState('flying'); });
$('crashQuitBtn').addEventListener('click', () => setState('title'));
$('helpClose').addEventListener('click', () => $('helpScreen').classList.add('hidden'));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  hud.resize();
});

// ---------- key actions ----------
function handleKeyEvents() {
  const events = input.takeEvents();
  for (const ev of events) {
    if (ev.type !== 'key') continue;
    const c = ev.code;
    if (state !== 'flying' && state !== 'paused') continue;
    switch (c) {
      case 'KeyF':
        aircraft.flaps = (aircraft.flaps + 1) % 3;
        audio.click();
        break;
      case 'KeyG':
        aircraft.gearDown = !aircraft.gearDown;
        audio.click();
        break;
      case 'KeyT':
        aircraft.elevTrim = THREE.MathUtils.clamp(
          aircraft.elevTrim + (ev.shiftKey ? -0.1 : 0.1), -1, 1);
        audio.click();
        break;
      case 'KeyC': {
        const i = CAMPAIGNS.indexOf(cameraMode);
        cameraMode = CAMPAIGNS[(i + 1) % CAMPAIGNS.length];
        audio.click();
        break;
      }
      case 'KeyP':
        setState(state === 'flying' ? 'paused' : 'flying');
        break;
      case 'Escape':
        if (!input.mouseLook && state === 'flying') setState('paused');
        break;
      case 'KeyM':
        audio.toggleMute();
        break;
      case 'KeyH':
        $('helpScreen').classList.toggle('hidden');
        break;
      case 'Backquote':
        telemetryOn = !telemetryOn;
        $('telemetry').classList.toggle('hidden', !telemetryOn);
        break;
      case 'Digit1': timeScale = 1; break;
      case 'Digit2': timeScale = 60; break;
      case 'Digit3': timeScale = 3600; break;
      case 'KeyR':
        resetFlight();
        setState('flying');
        break;
    }
  }
  for (const ev of events) {
    if (ev.type === 'action') {
      if (state !== 'flying' && state !== 'paused') continue;
      if (ev.action === 'gear') aircraft.gearDown = !aircraft.gearDown;
      if (ev.action === 'flaps') aircraft.flaps = (aircraft.flaps + 1) % 3;
      if (ev.action === 'camera') {
        const i = CAMPAIGNS.indexOf(cameraMode);
        cameraMode = CAMPAIGNS[(i + 1) % CAMPAIGNS.length];
      }
      if (ev.action === 'pause') setState(state === 'flying' ? 'paused' : 'flying');
    }
  }
}

// ---------- camera ----------
const camPos = new THREE.Vector3(30, SPAWN.h + 12, 40);
const camTarget = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function updateCamera(dt) {
  const ac = aircraft;
  let fov = 58;
  if (cameraMode === 'chase' || state !== 'flying') {
    const off = tmpV.set(0, 5.4, 14.5).applyQuaternion(ac.quat);
    tmpV2.copy(ac.pos).add(off);
    const k = 1 - Math.exp(-4.5 * dt);
    camPos.lerp(tmpV2, k);
    camTarget.copy(ac.pos).addScaledVector(tmpV.set(0, 0, -1).applyQuaternion(ac.quat), 18);
    camTarget.y += 1.5;
    fov = 58 + Math.min(17, ac.tas * 0.15);
  } else if (cameraMode === 'cockpit') {
    camPos.copy(AircraftModel.COCKPIT_POS).applyQuaternion(ac.quat).add(ac.pos);
    const head = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(headPitch, headYaw, 0, 'YXZ'));
    camera.quaternion.copy(ac.quat).multiply(head);
    camera.position.copy(camPos);
    fov = 62;
    camera.updateProjectionMatrix();
    return;
  } else { // orbit
    camPos.set(
      ac.pos.x + orbitDist * Math.cos(orbitPitch) * Math.sin(orbitYaw),
      ac.pos.y + orbitDist * Math.sin(orbitPitch),
      ac.pos.z + orbitDist * Math.cos(orbitPitch) * Math.cos(orbitYaw)
    );
    camTarget.copy(ac.pos);
    fov = 55;
  }
  camera.position.copy(camPos);
  camera.lookAt(camTarget);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

// shake applied post-look
function applyShake(dt) {
  const ac = aircraft;
  let amp = ac.buffet * 0.012;
  if (ac.onGround) amp += Math.min(1, ac.tas / 45) * 0.004;
  amp += WEATHER[weatherMode].gust * 0.0006;
  amp += (ac.rpm / 2400) * 0.0006;
  if (amp < 0.0001) return;
  camera.position.x += (Math.random() - 0.5) * amp * 2;
  camera.position.y += (Math.random() - 0.5) * amp * 2;
  camera.position.z += (Math.random() - 0.5) * amp * 2;
  camera.rotateZ((Math.random() - 0.5) * amp * 0.35);
  camera.rotateX((Math.random() - 0.5) * amp * 0.3);
}

// ---------- telemetry ----------
function updateTelemetry() {
  if (!telemetryOn) return;
  const ac = aircraft;
  const rho = ac.tas > 1 ? (2 * ac.qdyn) / (ac.tas * ac.tas) : 0;
  $('telemetry').innerHTML =
    `<b>FPS</b> ${fps.toFixed(0)}  <b>SIM</b> ${timeScale}×  <b>T+</b> ${ac.flightTime.toFixed(0)}s
<b>ALT</b> ${Math.round(ac.pos.y * 3.28084)} ft  <b>AGL</b> ${Math.round((ac.pos.y - terrain.height(ac.pos.x, ac.pos.z)) * 3.28084)} ft
<b>IAS</b> ${Math.round(ac.ias * 1.94384)} kt  <b>TAS</b> ${Math.round(ac.tas * 1.94384)} kt  <b>M</b> ${ac.mach.toFixed(2)}
<b>HDG</b> ${ac.heading.toFixed(0)}°  <b>PITCH</b> ${ac.pitch.toFixed(1)}°  <b>ROLL</b> ${ac.roll.toFixed(1)}°
<b>AoA</b> ${(ac.alpha / (Math.PI / 180)).toFixed(1)}°  <b>G</b> ${ac.loadFactor.toFixed(2)}  <b>VS</b> ${vsi.toFixed(0)} fpm
<b>RPM</b> ${Math.round(ac.rpm)}  <b>THR</b> ${Math.round(ac.throttle * 100)}%  <b>FUEL</b> ${ac.fuel.toFixed(0)} L
<b>WIND</b> ${weatherMode}  <b>Q</b> ${ac.qdyn.toFixed(0)} Pa  <b>ρ</b> ${rho.toFixed(3)} kg/m³
<b>FLAP</b> ${['UP', '1', '2'][ac.flaps]}  <b>GEAR</b> ${ac.gearDown ? 'DOWN' : 'UP'}  <b>TRIM</b> ${ac.elevTrim.toFixed(2)}
<b>THRUST</b> ${Math.round(ac.thrust)} N  <b>GROUND</b> ${ac.onGround ? 'YES' : 'NO'}
<b>STATE</b> ${state}  <b>KEYS</b> ${input.keys.size ? [...input.keys].join(' ') : '(none)'}  <b>IN</b> P${input.lastSt.pitch} R${input.lastSt.roll} Y${input.lastSt.rudder} T${input.lastSt.throttle.toFixed(2)}  <b>DE</b> ${((ac.de || 0) * 57.3).toFixed(1)}°`;
}

// ---------- main loop ----------
const clock = new THREE.Clock();
let minimapT = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  fpsN++; fpsT += dt;
  if (fpsT > 0.5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }

  // global slow orbit on title screen
  if (state === 'title') {
    titleOrbit += dt * 0.08;
    camera.position.set(
      SPAWN.x + Math.cos(titleOrbit) * 26,
      SPAWN.h + 9,
      SPAWN.z + Math.sin(titleOrbit) * 26
    );
    camera.lookAt(SPAWN.x, SPAWN.h + 2, SPAWN.z);
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    // 初始地形分块生成完毕后隐藏启动页
    if (!loadingHidden && terrain.queue.length === 0 && terrain.chunks.size > 0) {
      loadingHidden = true;
      $('loading').classList.add('done');
    }
  }

  input.allowLock = state === 'flying';

  if (state === 'flying' || state === 'paused') handleKeyEvents();

  if (state === 'flying' || state === 'crashed') {
    // mouse look
    const md = input.takeMouse();
    if (cameraMode === 'cockpit' && (input.mouseLook || input.dragging)) {
      headYaw -= md.dx * 0.0022;
      headPitch -= md.dy * 0.0022;
      headPitch = THREE.MathUtils.clamp(headPitch, -1.4, 1.4);
      headYaw = THREE.MathUtils.clamp(headYaw, -2.9, 2.9);
    } else if (cameraMode === 'orbit' && input.dragging) {
      orbitYaw -= md.dx * 0.005;
      orbitPitch = THREE.MathUtils.clamp(orbitPitch - md.dy * 0.005, -0.05, 1.2);
    }
  }

  if (state === 'flying') {
    const st = input.poll();
    // throttle from keyboard state
    aircraft.throttle = st.throttle;

    // gusty wind
    clouds.gustWind(simTime, gustWind);
    wind.copy(gustWind);

    // fixed-step physics
    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < 8) {
      const gh = terrain.height(aircraft.pos.x, aircraft.pos.z);
      aircraft.step(FIXED_DT, st, wind, gh);
      simTime += FIXED_DT;
      acc -= FIXED_DT;
      steps++;
      // crash checks
      if (aircraft.crashEvent) {
        onCrash(aircraft.crashEvent);
        break;
      }
      // water impact
      if (terrain.height(aircraft.pos.x, aircraft.pos.z) < 0 && aircraft.pos.y < 0.9) {
        onCrash('water');
        break;
      }
      // terrain strike at speed
      if (aircraft.onGround && Math.hypot(aircraft.vel.x, aircraft.vel.z) > 55) {
        onCrash('terrain');
        break;
      }
    }

    // VSI
    const altRate = (aircraft.pos.y - prevAlt) / Math.max(dt, 1e-4);
    vsi += (altRate * 196.85 - vsi) * Math.min(1, dt * 3);
    prevAlt = aircraft.pos.y;

    // time of day
    simHour = (simHour + dt * timeScale / 3600) % 24;

    // world updates
    sky.update(simHour, simTime, dt, WEATHER[weatherMode], aircraft.pos);
    const flash = clouds.update(dt, aircraft.pos, simTime, audio);
    sky.setFlash(flash * 0.5);
    terrain.update(aircraft.pos.x, aircraft.pos.z);
    terrain.setWaterUniforms(sky.sunDir, sky.sunColor, sky.horizonColor, scene.fog.color, scene.fog.near, scene.fog.far);
    scene.fog.color.copy(sky.horizonColor);
    model.update(aircraft, dt, sky.dayFactor < 0.35, vsi);
    explosion.update(dt);
    audio.update(aircraft, dt, WEATHER[weatherMode]);

    // cloud veil (inside cloud)
    const cd = clouds.nearestCloudDist(aircraft.pos);
    const veil = document.getElementById('cloudVeil');
    veil.style.opacity = THREE.MathUtils.clamp((350 - cd) / 350, 0, 0.85);

    // HUD + minimap
    hud.draw(aircraft, wind, { vsi, simHour }, dt);
    minimapT += dt;
    if (minimapT > 0.2) {
      minimapT = 0;
      minimap.draw(aircraft, clouds);
    }
    updateTelemetry();
  }

  if (state === 'crashed') {
    explosion.update(dt);
    if (crashTimer > 0) {
      crashTimer -= dt;
      if (crashTimer <= 0) {
        $('crashScreen').classList.remove('hidden');
      }
    }
  }

  if (state !== 'flying' && state !== 'crashed') {
    // idle world animation behind menus
    sky.update(simHour, simTime, dt, WEATHER[weatherMode], camera.position);
    clouds.update(dt, camera.position, simTime, null);
    terrain.update(camera.position.x, camera.position.z);
    model.update(aircraft, dt, sky.dayFactor < 0.35, 0);
    scene.fog.color.copy(sky.horizonColor);
    if (audio.started) audio.update(aircraft, dt, WEATHER[weatherMode]);
  }

  if (state !== 'title') updateCamera(dt);
  if (state === 'flying') applyShake(dt);

  renderer.render(scene, camera);
}

function onCrash(kind) {
  const msgs = {
    hard: ['硬着陆', '垂直过载过大，飞机结构损坏。'],
    belly: ['机腹着陆', '起落架未放下，机身触地。'],
    terrain: ['地形撞击', '飞机撞击地形。'],
    water: ['水上迫降', '飞机坠入水中。'],
  };
  const m = msgs[kind] || ['坠毁', '飞机损毁。'];
  $('crashTitle').textContent = m[0];
  $('crashMsg').textContent = m[1];
  $('crashStats').textContent =
    `飞行时间 ${aircraft.flightTime.toFixed(0)}s · 剩余油量 ${aircraft.fuel.toFixed(0)}L · ` +
    `撞击速度 ${Math.round(aircraft.tas * 1.94384)} kt · 高度 ${Math.round(aircraft.pos.y * 3.28084)} ft`;
  const gh = terrain.height(aircraft.pos.x, aircraft.pos.z);
  diag(`CRASH ${kind} t=${aircraft.flightTime.toFixed(1)}s pos=(${aircraft.pos.x.toFixed(0)},${aircraft.pos.y.toFixed(0)},${aircraft.pos.z.toFixed(0)}) gh=${gh.toFixed(0)} ias=${(aircraft.ias * 1.94384).toFixed(0)}kt agl=${(aircraft.pos.y - gh).toFixed(1)}m vy=${aircraft.vel.y.toFixed(1)}`);
  explosion.trigger(aircraft.pos, kind === 'water');
  audio.crashSound();
  crashTimer = 1.4;
  setState('crashed');
  $('crashScreen').classList.add('hidden');
}

// initial paint
applyWeather();
model.setPaint(0);
resetFlight();
diag('boot-ok');
window.__aerosimReady = true;
if (window.__aerosimBootTimer) clearInterval(window.__aerosimBootTimer);
frame();
