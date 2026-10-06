// 6-DOF flight dynamics model + ISA standard atmosphere
// World axes: +X east, +Y up, +Z south (north = -Z)
// Body axes (three.js native): +X right, +Y up, +Z backward (nose = -Z)
// Body rates: wx = pitch (nose-up +), wy = yaw (nose-left +), wz = roll (roll-left +)
import * as THREE from 'three';
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['physics'] = true;

export const ISA = {
  temperature(h) { return h <= 11000 ? 288.15 - 0.0065 * h : 216.65; },
  pressure(h) {
    if (h <= 11000) return 101325 * Math.pow(1 - 0.0065 * h / 288.15, 5.2561);
    return 22632 * Math.exp(-0.0001577 * (h - 11000));
  },
  density(h) { return this.pressure(h) / (287.05 * this.temperature(h)); },
  speedOfSound(h) { return Math.sqrt(1.4 * 287.05 * this.temperature(h)); },
};

const DEG = Math.PI / 180;

export class Aircraft {
  constructor() {
    // Cessna-172-class geometry/mass
    this.mass = 1100;            // kg
    this.S = 16.2;               // wing area m²
    this.b = 11.0;               // wingspan m
    this.c = 1.55;               // mean chord m
    this.Ixx = 1300; this.Iyy = 1500; this.Izz = 2300;
    this.g = 9.80665;

    // aerodynamic derivatives
    this.CL0 = 0.24; this.CLalpha = 5.4;
    this.CD0 = 0.038; this.k = 0.047;
    this.CyBeta = -0.5; this.CyDr = -0.12;
    this.ClBeta = 0.08; this.ClDa = 0.30; this.ClP = -0.6; this.ClR = 0.05;
    this.CmAlpha = -0.8; this.CmDe = 0.46; this.CmQ = -9.0;
    this.CnBeta = -0.08; this.CnDr = -0.14; this.CnDa = -0.06; this.CnP = -0.1; this.CnR = -0.3;

    this.T0 = 4300;              // static thrust N (max rpm, SL)
    this.Pmax = 118000;          // W
    this.rpmMax = 2400;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();      // ground velocity, m/s
    this.quat = new THREE.Quaternion();
    this.rates = { x: 0, y: 0, z: 0 };  // body rates rad/s

    this.throttle = 0;
    this.rpm = 0;
    this.flaps = 0;              // 0,1,2
    this.gearDown = true;
    this.gearAnim = 1;           // 1 = down, 0 = up
    this.elevTrim = 0;           // -1..1
    this.fuel = 200;             // litres
    this.fuelCap = 200;

    // control deflections (rad)
    this.de = 0; this.da = 0; this.dr = 0;

    // derived / flags
    this.alpha = 0; this.beta = 0; this.V = 0; this.Vair = 0;
    this.qdyn = 0; this.stalled = false; this.buffet = 0;
    this.stallKt = 48; // 失速速度(IAS, kt)，每步由 CLmax 更新
    this.loadFactor = 1; this.onGround = false;
    this.overspeed = false;
    this.ias = 0; this.tas = 0; this.mach = 0;
    this.heading = 0; this.pitch = 0; this.roll = 0;
    this.simTime = 0;
    this.flightTime = 0;
    this.crashEvent = null;
    this.thrust = 0;

    this._vAirB = new THREE.Vector3();
    this._fBody = new THREE.Vector3();
    this._gBody = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._invQ = new THREE.Quaternion();
    this._acc = new THREE.Vector3();
    this._dq = new THREE.Quaternion();
    this._eul = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  reset(x = 0, y = 200, z = 0, headingDeg = 0) {
    this.pos.set(x, y, z);    this.vel.set(0, 0, 0);
    const h = headingDeg * DEG;
    // yaw about +Y: positive heading (turn right from north) = negative Y rotation
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -h);
    this.rates.x = this.rates.y = this.rates.z = 0;
    this.throttle = 0; this.rpm = 0; this.flaps = 0;
    this.gearDown = true; this.gearAnim = 1; this.elevTrim = 0;
    this.fuel = this.fuelCap;
    this.de = this.da = this.dr = 0;
    this.simTime = 0; this.flightTime = 0;
  }

  step(dt, input, wind, groundH) {
    this.crashEvent = null;
    // --- atmosphere at altitude
    const h = Math.max(0, this.pos.y);
    const rho = ISA.density(h);
    const sigma = rho / 1.225;
    const a0 = ISA.speedOfSound(h);

    // --- air-relative velocity (world) & body components
    const vwx = this.vel.x - wind.x, vwy = this.vel.y - wind.y, vwz = this.vel.z - wind.z;
    const V = Math.max(Math.hypot(vwx, vwy, vwz), 0.5);
    const invQ = this._invQ.copy(this.quat).invert();
    this._vAirB.set(vwx, vwy, vwz).applyQuaternion(invQ);
    const u = -this._vAirB.z, v = this._vAirB.x, w = -this._vAirB.y;
    const alpha = Math.atan2(w, Math.max(u, 0.5));
    const beta = Math.atan2(v, Math.max(u, 0.5));
    this.alpha = alpha; this.beta = beta; this.Vair = V;
    this.qdyn = 0.5 * rho * V * V;

    // --- control deflections with rate limits
    const maxDe = 14 * DEG, maxDa = 20 * DEG, maxDr = 25 * DEG;
    const deT = THREE.MathUtils.clamp(input.pitch * maxDe + this.elevTrim * 8 * DEG, -maxDe, maxDe);
    const daT = THREE.MathUtils.clamp(-input.roll * maxDa, -maxDa, maxDa);
    const drT = THREE.MathUtils.clamp(input.rudder * maxDr, -maxDr, maxDr);
    const rate = 1.6; // rad/s surface rate
    this.de += THREE.MathUtils.clamp(deT - this.de, -rate * dt, rate * dt);
    this.da += THREE.MathUtils.clamp(daT - this.da, -rate * dt, rate * dt);
    this.dr += THREE.MathUtils.clamp(drT - this.dr, -rate * dt, rate * dt);

    // --- stall model（失连续 CLmax = CL(失速迎角)，干净构型 Vs≈48kt）
    const aStall = (16.5 + this.flaps * 1.6) * DEG;
    const CLmax = this.CL0 + this.CLalpha * Math.sin(aStall);
    this.stallKt = Math.sqrt(2 * this.mass * this.g / (1.225 * this.S * CLmax)) * 1.94384;
    let CL, CDextra = 0;
    const aAbs = Math.abs(alpha);
    if (aAbs < aStall) {
      CL = this.CL0 + this.CLalpha * alpha;
    } else {
      const over = aAbs - aStall;
      CL = Math.sign(alpha) * Math.max(0, CLmax - over * 0.7);
      CDextra = 0.4 * over * over;
    }
    this.stalled = !this.onGround && aAbs > aStall;   // 地面滑跑不报失速（低速下阵风会产生假迎角）
    this.buffet = this.onGround ? 0 : THREE.MathUtils.clamp((aAbs - aStall * 0.78) / (aStall * 0.35), 0, 1);

    // --- drag
    const flapCd = [0, 0.006, 0.014][this.flaps];
    const gearCd = this.gearAnim * 0.006;
    // ground effect: reduce induced drag when close to ground
    const hAgl = this.pos.y - groundH;
    const ge = Math.exp(-Math.max(0, hAgl) / (this.b / 3));
    const kEff = this.k * (1 - 0.5 * ge);
    const CD = this.CD0 + flapCd + gearCd + kEff * CL * CL + CDextra;

    const q = this.qdyn, S = this.S, B = this.b, C = this.c;
    const L = q * S * CL;
    const D = q * S * CD;

    // --- side force
    const Fside = q * S * (this.CyBeta * beta + this.CyDr * this.dr);

    // --- thrust (propeller model)
    this.rpm += (this.throttle * this.rpmMax - this.rpm) * Math.min(1, dt / 1.6);
    let T = 0;
    if (this.fuel > 0 && this.throttle > 0.02) {
      const Tstatic = this.T0 * Math.pow(this.rpm / this.rpmMax, 2) * sigma;
      const Tpower = (this.Pmax * sigma) / Math.max(V, 3.5);
      T = Math.min(Tstatic, Tpower);
    } else {
      T = -6 * sigma * Math.min(1, V / 40); // windmilling drag
    }
    this.thrust = T;

    // --- forces in body frame: (side, lift + D·sinα, drag·cosα) with thrust along -Z
    this._fBody.set(Fside, L + D * Math.sin(alpha), D * Math.cos(alpha) - T);
    // --- moments
    let Mx = q * S * C * (this.CmAlpha * alpha + this.CmDe * this.de +
      this.CmQ * THREE.MathUtils.clamp(this.rates.x * C / (2 * V), -3, 3));
    let Mz = q * S * B * (this.ClBeta * beta + this.ClDa * this.da +
      this.ClP * THREE.MathUtils.clamp(this.rates.z * B / (2 * V), -3, 3) +
      this.ClR * THREE.MathUtils.clamp(this.rates.y * B / (2 * V), -3, 3));
    let My = q * S * B * (this.CnBeta * beta + this.CnDr * this.dr + this.CnDa * this.da +
      this.CnP * THREE.MathUtils.clamp(this.rates.z * B / (2 * V), -3, 3) +
      this.CnR * THREE.MathUtils.clamp(this.rates.y * B / (2 * V), -3, 3));
    // stall: proverse roll / yaw (wing drop)
    if (this.stalled) {
      Mz += q * S * B * 0.4 * Math.sign(beta || 0.001);
      My += q * S * B * -0.12 * Math.sign(beta || 0.001);
    }
    // overspeed: heavy controls
    this.overspeed = V > 75;
    if (this.overspeed) { Mx *= 0.75; Mz *= 0.75; My *= 0.75; }

    // --- linear acceleration (body → world)
    this._gBody.set(0, -this.g, 0).applyQuaternion(invQ);
    const acc = this._acc.set(
      this._fBody.x / this.mass + this._gBody.x,
      this._fBody.y / this.mass + this._gBody.y,
      this._fBody.z / this.mass + this._gBody.z
    ).applyQuaternion(this.quat);
    this.vel.addScaledVector(acc, dt);

    // --- ground handling
    const clearance = this.gearDown ? 1.23 * this.gearAnim + 0.1 : 0.6;
    const gh = groundH + clearance;
    this.onGround = false;
    if (this.pos.y <= gh) {
      this.pos.y = gh;
      if (this.vel.y < 0) {
        if (this.vel.y < -9) { this.crashEvent = 'hard'; }
        else if (this.vel.y < -3.5) { this.vel.y = -this.vel.y * 0.25; } // bounce
        else this.vel.y = 0;
      }
      this.onGround = true;
      if (this.gearAnim < 0.5) { this.crashEvent = 'belly'; } // gear-up touch
      // rolling friction (reduced by lift)
      const W = this.mass * this.g;
      const N = Math.max(0, W - L);
      const mu = 0.035 + (input.brake ? 0.6 : 0);
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > 0.01) {
        const f = Math.min(mu * N / this.mass * dt, hv);
        this.vel.x -= this.vel.x / hv * f;
        this.vel.z -= this.vel.z / hv * f;
      }
      // nose-wheel steering
      const steerRate = this.dr * 1.4 * Math.min(1, hv / 18);
      this.rates.y += (steerRate - this.rates.y) * Math.min(1, dt * 4);
      this.rates.x *= Math.max(0, 1 - dt * 3);
      this.rates.z *= Math.max(0, 1 - dt * 3);
      // 起落架扶正：横滚强扶正（抗风侧倾），俯仰弱扶正（不妨碍抬轮）
      const eul = this._eul.setFromQuaternion(this.quat, 'YXZ');
      eul.x *= Math.max(0, 1 - dt * 2);
      eul.z *= Math.max(0, 1 - dt * 8);
      this.quat.setFromEuler(eul);
    }

    // --- integrate position
    this.pos.addScaledVector(this.vel, dt);

    // --- angular acceleration & integration
    this.rates.x += (Mx / this.Ixx) * dt;
    this.rates.y += (My / this.Iyy) * dt;
    this.rates.z += (Mz / this.Izz) * dt;
    // angular damping sanity clamp
    const rc = 4;
    this.rates.x = THREE.MathUtils.clamp(this.rates.x, -rc, rc);
    this.rates.y = THREE.MathUtils.clamp(this.rates.y, -rc, rc);
    this.rates.z = THREE.MathUtils.clamp(this.rates.z, -rc, rc);
    const dq = this._dq.set(this.rates.x * dt / 2, this.rates.y * dt / 2, this.rates.z * dt / 2, 1).normalize();
    this.quat.multiply(dq).normalize();

    // --- fuel
    if (this.fuel > 0 && this.throttle > 0.02) {
      this.fuel -= (2 + 26 * this.throttle) * dt / 3600;
      if (this.fuel < 0) this.fuel = 0;
    }

    // --- derived values
    this.V = V;
    this.ias = Math.sqrt(2 * q / 1.225);
    this.tas = V;
    this.mach = V / a0;
    this.loadFactor = Math.hypot(L, D) / (this.mass * this.g);
    const e = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.quat);
    this.heading = ((-e.y / DEG) + 720) % 360;
    this.pitch = e.x / DEG;
    this.roll = e.z / DEG;
    this.simTime += dt;
    this.flightTime += dt;
  }
}
