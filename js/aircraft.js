// Detailed procedural aircraft model (Cessna-172 class)
import * as THREE from 'three';
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['aircraft'] = true;

const DEG = Math.PI / 180;

function airfoilShape(chord, t) {
  const s = new THREE.Shape();
  const tc = chord * t;
  s.moveTo(0, 0);
  s.bezierCurveTo(chord * 0.05, tc * 0.9, chord * 0.35, tc, chord * 0.7, tc * 0.55);
  s.bezierCurveTo(chord * 0.9, tc * 0.25, chord * 0.98, 0.01, chord, 0);
  s.bezierCurveTo(chord * 0.98, -tc * 0.25, chord * 0.85, -tc * 0.5, chord * 0.5, -tc * 0.6);
  s.bezierCurveTo(chord * 0.2, -tc * 0.75, chord * 0.05, -tc * 0.4, 0, 0);
  return s;
}

function extrudeShape(shape, depth) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  geo.rotateY(-Math.PI / 2); // shape-x -> world z (chord), extrude z -> world -x (span)
  return geo;
}

function makeGaugeFace(label, max, unit) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.fillStyle = '#0d1117';
  ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#e8edf2';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(c, c, c - 6, 0, Math.PI * 2); ctx.stroke();
  // ticks: 270° sweep from -225° to 45° (0 at top)
  const a0 = -225, a1 = 45;
  for (let i = 0; i <= 10; i++) {
    const a = (a0 + (a1 - a0) * i / 10) * DEG;
    const big = i % 5 === 0;
    ctx.strokeStyle = big ? '#fff' : '#9aa5b1';
    ctx.lineWidth = big ? 4 : 2;
    const r1 = c - (big ? 26 : 18), r2 = c - 10;
    ctx.beginPath();
    ctx.moveTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1);
    ctx.lineTo(c + Math.sin(a) * r2, c - Math.cos(a) * r2);
    ctx.stroke();
  }
  ctx.fillStyle = '#e8edf2';
  ctx.font = `bold ${size * 0.11}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(label, c, c + size * 0.28);
  ctx.font = `${size * 0.08}px monospace`;
  ctx.fillStyle = '#9aa5b1';
  ctx.fillText(unit, c, c + size * 0.40);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PAINTS = [
  { name: 'white-blue', base: '#eef1f4', stripe: '#1e5aa8', tail: '#1e5aa8', text: '#1e5aa8' },
  { name: 'red-white', base: '#f4f4f4', stripe: '#b02a20', tail: '#b02a20', text: '#b02a20' },
  { name: 'green-white', base: '#f0f4ee', stripe: '#1e7a46', tail: '#1e7a46', text: '#1e7a46' },
  { name: 'yellow-black', base: '#f5d90a', stripe: '#151515', tail: '#151515', text: '#151515' },
];

function makeLiveryTexture(idx) {
  const p = PAINTS[idx];
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  // base
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, 1024, 512);
  // cheatline band (v 0.42-0.56; v=0 tail, v=1 nose in lathe UV)
  ctx.fillStyle = p.stripe;
  ctx.fillRect(0, 512 * 0.42, 1024, 512 * 0.14);
  // tail band (near v=0)
  ctx.fillRect(0, 512 * 0.04, 1024, 512 * 0.10);
  // nose accent
  ctx.fillStyle = p.stripe;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(0, 512 * 0.90, 1024, 512 * 0.10);
  ctx.globalAlpha = 1;
  // registration text (tail area, wraps around: draw twice for u continuity)
  ctx.fillStyle = p.text;
  ctx.font = 'bold 64px monospace';
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(256, 512 * 0.17);
  ctx.fillText('N-172X', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(768, 512 * 0.17);
  ctx.fillText('N-172X', 0, 0);
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function makeBlurTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  for (let i = 0; i < 220; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = c * (0.12 + Math.random() * 0.85);
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    const len = 4 + Math.random() * 14;
    ctx.strokeStyle = `rgba(200,205,215,${0.05 + Math.random() * 0.10})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a + Math.PI / 2) * len, y + Math.sin(a + Math.PI / 2) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export class AircraftModel {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.paintMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.12 });
    this.metalMat = new THREE.MeshStandardMaterial({ color: 0x9ba1a8, roughness: 0.35, metalness: 0.85 });
    this.glassMat = new THREE.MeshStandardMaterial({ color: 0x10161e, roughness: 0.06, metalness: 0.92 });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.85 });
    this.tireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });

    this.blurTex = makeBlurTexture();   // 须先于 build()，机体模糊盘贴图要用
    this.build();
    this.setPaint(0);

    // 座舱仪表：build() → buildCockpit() 已创建面板并填充 this.gauges

    this.clockT = 0;
  }

  build() {
    const g = this.group;

    // ---- fuselage (lathe) ----
    const pts = [
      [0.001, 3.15], [0.10, 3.05], [0.22, 2.85], [0.34, 2.45], [0.47, 1.9],
      [0.56, 1.3], [0.60, 0.7], [0.60, 0.0], [0.58, -0.7], [0.54, -1.4],
      [0.50, -2.1], [0.44, -2.7], [0.34, -3.15], [0.20, -3.4], [0.001, -3.5],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const fusGeo = new THREE.LatheGeometry(pts, 28);
    fusGeo.rotateX(Math.PI / 2); // lathe axis -> Z, tail at +Z, nose at -Z
    this.fuselage = new THREE.Mesh(fusGeo, this.paintMat);
    g.add(this.fuselage);

    // ---- canopy ----
    const canopyGeo = new THREE.SphereGeometry(0.62, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const canopy = new THREE.Mesh(canopyGeo, this.glassMat);
    canopy.scale.set(0.92, 0.55, 1.85);
    canopy.position.set(0, 0.40, -0.55);
    g.add(canopy);

    // ---- wing ----
    const wingGeo = extrudeShape(airfoilShape(1.75, 0.12), 11);
    wingGeo.translate(5.5, 0, 0); // center span
    this.wing = new THREE.Mesh(wingGeo, this.paintMat);
    this.wing.position.set(0, -0.12, -0.35);
    g.add(this.wing);

    // flaps (inboard trailing edge)
    this.flapL = this.makeSurface(2.4, 0.05, 0.55, -2.9, -0.12, 1.15);
    this.flapR = this.makeSurface(2.4, 0.05, 0.55, 2.9, -0.12, 1.15);
    // ailerons (outboard)
    this.ailL = this.makeSurface(2.2, 0.05, 0.35, -4.35, -0.12, 1.15);
    this.ailR = this.makeSurface(2.2, 0.05, 0.35, 4.35, -0.12, 1.15);
    g.add(this.flapL.pivot, this.flapR.pivot, this.ailL.pivot, this.ailR.pivot);

    // ---- horizontal stabilizer + elevator ----
    const stabGeo = extrudeShape(airfoilShape(0.95, 0.11), 3.6);
    stabGeo.translate(1.8, 0, 0);
    const stab = new THREE.Mesh(stabGeo, this.paintMat);
    stab.position.set(0, 0.24, 2.30);
    g.add(stab);
    this.elevator = this.makeSurface(2.9, 0.05, 0.55, 0, 0.24, 3.0);
    g.add(this.elevator.pivot);

    // ---- vertical stabilizer + rudder ----
    const finShape = new THREE.Shape();
    finShape.moveTo(2.05, 0.28);
    finShape.lineTo(2.42, 1.34);
    finShape.lineTo(2.78, 1.34);
    finShape.lineTo(3.12, 0.30);
    finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.09, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2);
    finGeo.translate(0.045, 0, 0);
    const fin = new THREE.Mesh(finGeo, this.paintMat);
    g.add(fin);
    this.rudder = this.makeSurface(0.07, 0.95, 0.5, 0, 0.72, 2.85, true);
    g.add(this.rudder.pivot);

    // ---- propeller ----
    this.propGroup = new THREE.Group();
    this.propGroup.position.set(0, 0, -3.48);
    const spinner = new THREE.Mesh(
      new THREE.ConeGeometry(0.17, 0.55, 16).rotateX(-Math.PI / 2), this.metalMat);
    spinner.position.z = -0.2;
    this.propGroup.add(spinner);
    const bladeGeo = new THREE.BoxGeometry(0.045, 1.15, 0.15);
    bladeGeo.translate(0, 0.62, 0);
    for (let i = 0; i < 2; i++) {
      const blade = new THREE.Mesh(bladeGeo, this.darkMat);
      blade.rotation.z = i * Math.PI / 2;
      const twist = new THREE.Group();
      twist.rotation.y = 0.48;
      twist.add(blade);
      const holder = new THREE.Group();
      holder.rotation.z = i * Math.PI / 2;
      holder.add(twist);
      this.propGroup.add(holder);
    }
    g.add(this.propGroup);
    // blur disc
    this.blurDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1.18, 32),
      new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, map: this.blurTex,
      })
    );
    this.blurDisc.position.z = -3.40;
    g.add(this.blurDisc);

    // ---- landing gear ----
    this.gearGroups = [];
    const mkGear = (x, z, wheelR, wheelW) => {
      const grp = new THREE.Group();
      grp.position.set(x, -0.35, z);
      const strut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.05, 0.55, 8), this.metalMat);
      strut.position.y = -0.22;
      grp.add(strut);
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 18).rotateZ(Math.PI / 2),
        this.tireMat);
      wheel.position.y = -0.5 - wheelR * 0.4;
      grp.add(wheel);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelR * 0.45, wheelR * 0.45, wheelW + 0.02, 12).rotateZ(Math.PI / 2),
        this.metalMat);
      hub.position.y = wheel.position.y;
      grp.add(hub);
      g.add(grp);
      this.gearGroups.push({ grp, baseY: -0.35 });
      return grp;
    };
    mkGear(0, -1.75, 0.20, 0.10);        // nose
    mkGear(-0.80, -0.10, 0.27, 0.13);    // main L
    mkGear(0.80, -0.10, 0.27, 0.13);     // main R

    // ---- lights ----
    const mkLight = (color, x, y, z) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0.3 }));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    this.navL = mkLight(0xff2020, -5.42, -0.12, 0.55);
    this.navR = mkLight(0x20ff40, 5.42, -0.12, 0.55);
    this.navT = mkLight(0xffffff, 0, 0.28, 3.12);
    this.beacon = mkLight(0xff3020, 0, 0.70, 0.45);

    // ---- cockpit interior ----
    this.buildCockpit();

    // shadows
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.blurDisc.castShadow = false;
  }

  makeSurface(w, h, d, x, y, z, isRudder = false) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (!isRudder) geo.translate(0, 0, d / 2);   // hinge at front (TE extends +Z)
    else geo.translate(0, 0, d / 2);
    const mesh = new THREE.Mesh(geo, this.paintMat);
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.add(mesh);
    return { pivot, mesh };
  }

  buildCockpit() {
    const g = this.group;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 2.4), this.darkMat);
    floor.position.set(0, 0.02, -0.25);
    g.add(floor);
    // seat (right)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.55), this.darkMat);
    seat.position.set(0.32, 0.16, 0.30);
    g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.6, 0.13), this.darkMat);
    back.position.set(0.32, 0.45, 0.58);
    back.rotation.x = -0.15;
    g.add(back);

    // instrument panel
    this.panel = new THREE.Group();
    this.panel.position.set(0, 0.50, -1.02);
    this.panel.rotation.x = -0.38;
    const panelBox = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 0.09), this.darkMat);
    this.panel.add(panelBox);
    g.add(this.panel);

    // gauges: [label, max, unit]
    const defs = [
      ['ASI', 160, 'KTS'], ['ALT', 10, 'FT x1000'],
      ['RPM', 300, 'x10'], ['FUEL', 200, 'L'],
      ['VSI', 2000, 'FPM'], ['OIL', 120, 'PSI'],
    ];
    this.gauges = [];
    defs.forEach((def, i) => {
      const col = i % 3, row = (i / 3) | 0;
      const gx = -0.38 + col * 0.38;
      const gy = 0.10 - row * 0.20;
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(0.085, 24),
        new THREE.MeshBasicMaterial({ map: makeGaugeFace(def[0], def[1], def[2]) })
      );
      face.position.set(gx, gy, 0.048);
      this.panel.add(face);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.088, 0.008, 8, 24), this.metalMat);
      rim.position.set(gx, gy, 0.047);
      this.panel.add(rim);
      const needle = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.062, 0.004).translate(0, 0.026, 0),
        new THREE.MeshBasicMaterial({ color: 0xff5040 }));
      needle.position.set(gx, gy, 0.055);
      this.panel.add(needle);
      this.gauges.push({ needle, max: def[1], type: def[0] });
    });

    // yoke
    this.yokeCol = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.03, 0.5, 10), this.darkMat);
    this.yokeCol.position.set(0.32, 0.34, -0.72);
    this.yokeCol.rotation.x = 0.45;
    g.add(this.yokeCol);
    this.yoke = new THREE.Group();
    this.yoke.position.set(0.32, 0.52, -0.60);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.026, 10, 24), this.darkMat);
    wheel.rotation.x = Math.PI / 2;
    this.yoke.add(wheel);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), this.darkMat);
    this.yoke.add(spoke);
    g.add(this.yoke);
  }

  setPaint(idx) {
    if (this.paintMat.map) this.paintMat.map.dispose();
    this.paintMat.map = makeLiveryTexture(idx);
    this.paintMat.needsUpdate = true;
  }

  update(ac, dt, night, vsi = 0) {
    this.clockT += dt;
    const g = this.group;
    g.position.copy(ac.pos);
    g.quaternion.copy(ac.quat);

    // control surfaces
    this.ailL.pivot.rotation.x = -ac.da;
    this.ailR.pivot.rotation.x = ac.da;
    this.flapL.pivot.rotation.x = this.flapR.pivot.rotation.x =
      [0, 14 * DEG, 32 * DEG][ac.flaps];
    this.elevator.pivot.rotation.x = ac.de;
    this.rudder.pivot.rotation.y = ac.dr;

    // propeller
    const omega = (ac.rpm / 60) * Math.PI * 2;
    this.propGroup.rotation.z -= omega * dt;
    this.blurDisc.material.opacity = THREE.MathUtils.clamp((ac.rpm - 500) / 1600, 0, 1) * 0.30;

    // gear
    const target = ac.gearDown ? 1 : 0;
    ac.gearAnim += (target - ac.gearAnim) * Math.min(1, dt * 1.8);
    for (const gr of this.gearGroups) {
      gr.grp.position.y = gr.baseY + (1 - ac.gearAnim) * 0.62;
    }

    // panel needles
    const vals = {
      ASI: ac.ias * 1.94384, ALT: ac.pos.y * 3.28084 / 1000,
      RPM: ac.rpm / 10, FUEL: ac.fuel, VSI: Math.abs(vsi), OIL: 60 + ac.rpm / 40,
    };
    for (const gauge of this.gauges) {
      const v = THREE.MathUtils.clamp((vals[gauge.type] || 0) / gauge.max, 0, 1);
      gauge.needle.rotation.z = (225 - 270 * v) * DEG;
    }

    // yoke follows controls
    this.yoke.rotation.z = -ac.da * 2.2;
    this.yoke.rotation.x = ac.de * 1.1;

    // lights
    const li = night ? 2.6 : 0.25;
    this.navL.material.emissiveIntensity = li;
    this.navR.material.emissiveIntensity = li;
    this.navT.material.emissiveIntensity = night ? 2.0 : 0.15;
    this.beacon.material.emissiveIntensity = (this.clockT % 1.4) < 0.12 ? 5 : 0.05;
  }

  // camera anchor points in body space
  static COCKPIT_POS = new THREE.Vector3(0.32, 0.60, -0.30);
  static CHASE_POS = new THREE.Vector3(0, 5.4, 14.5);
}
