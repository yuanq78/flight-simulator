// Canvas-based HUD (attitude, tapes, compass, engine) + minimap
const DEG = Math.PI / 180;
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['hud'] = true;

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hintT = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.canvas.style.width = innerWidth + 'px';
    this.canvas.style.height = innerHeight + 'px';
  }

  draw(ac, wind, opts, dt) {
    const ctx = this.ctx;
    this.stallKt = ac.stallKt || 48;
    const dpr = this.dpr;
    const W = innerWidth, H = innerHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '12px "JetBrains Mono", Consolas, monospace';

    const cx = W / 2, cy = H / 2;

    // ---------- attitude indicator ----------
    const R = Math.min(W, H) * 0.13;
    ctx.save();
    ctx.translate(cx, cy);
    // bezel
    ctx.beginPath(); ctx.arc(0, 0, R + 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();
    // clip & draw horizon
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
    ctx.rotate(-ac.roll * DEG);
    const pitchOff = ac.pitch * 3.2;
    // sky
    ctx.fillStyle = '#2a5a8c';
    ctx.fillRect(-R * 2, -R * 3 - pitchOff, R * 4, R * 3);
    // ground
    ctx.fillStyle = '#6b5433';
    ctx.fillRect(-R * 2, -pitchOff, R * 4, R * 3);
    // horizon line
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-R * 2, -pitchOff); ctx.lineTo(R * 2, -pitchOff); ctx.stroke();
    // pitch ladder
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (let p = -30; p <= 30; p += 10) {
      if (p === 0) continue;
      const y = -pitchOff - p * 3.2;
      if (Math.abs(y) > R + 20) continue;
      const w2 = p % 20 === 0 ? 34 : 20;
      ctx.beginPath();
      ctx.moveTo(-w2, y); ctx.lineTo(w2, y);
      ctx.stroke();
      if (p % 20 === 0) ctx.fillText(Math.abs(p), 0, y - 4);
    }
    // bank markers
    ctx.strokeStyle = '#ffd24d';
    for (const b of [-60, -30, 0, 30, 60]) {
      const a = b * DEG;
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * (R - 6), -Math.cos(a) * (R - 6));
      ctx.lineTo(Math.sin(a) * (R - 16), -Math.cos(a) * (R - 16));
      ctx.stroke();
    }
    ctx.restore();
    // fixed aircraft symbol
    ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-26, 0); ctx.lineTo(-8, 0);
    ctx.moveTo(8, 0); ctx.lineTo(26, 0);
    ctx.moveTo(0, 0); ctx.lineTo(0, 6);
    ctx.stroke();
    // roll pointer
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath();
    ctx.moveTo(0, -R - 4);
    ctx.lineTo(-7, -R - 16);
    ctx.lineTo(7, -R - 16);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // ---------- airspeed tape (left) ----------
    this.tape(cx - R - 46, cy, 90, ac.ias, 0, 90, 10, 'kts', true);
    // Mach + AoA below
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'center';
    ctx.fillText('M ' + ac.mach.toFixed(2), cx - R - 46, cy + 108);
    ctx.fillText('AoA ' + (ac.alpha / DEG).toFixed(1) + '°', cx - R - 46, cy + 126);

    // ---------- altitude tape (right) ----------
    this.tape(cx + R + 46, cy, 90, ac.pos.y * 3.28084, 0, 12000, 500, 'ft', false);
    // VSI
    const vsi = opts.vsi || 0;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText((vsi >= 0 ? '+' : '') + vsi.toFixed(0) + ' fpm', cx + R + 46, cy + 108);

    // ---------- heading ribbon ----------
    const rbY = H - 54, rbW = Math.min(560, W * 0.5);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - rbW / 2, rbY - 16, rbW, 32);
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    const pxPerDeg = rbW / 120;
    const hdg = ac.heading;
    for (let h = -180; h <= 180; h += 5) {
      const abs = ((hdg + h) % 360 + 360) % 360;
      const x = cx + h * pxPerDeg;
      if (abs % 10 === 0) {
        const major = abs % 30 === 0;
        ctx.beginPath();
        ctx.moveTo(x, rbY + (major ? 2 : 8));
        ctx.lineTo(x, rbY + 14);
        ctx.stroke();
        if (major) {
          const label = abs === 0 ? 'N' : abs === 90 ? 'E' : abs === 180 ? 'S' : abs === 270 ? 'W' : (abs / 10).toString();
          ctx.fillText(label, x, rbY - 4);
        }
      }
    }
    ctx.restore();
    // heading bug (center)
    ctx.fillStyle = '#ff5040';
    ctx.beginPath();
    ctx.moveTo(cx, rbY - 18);
    ctx.lineTo(cx - 6, rbY - 8);
    ctx.lineTo(cx + 6, rbY - 8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(hdg.toFixed(0).padStart(3, '0') + '°', cx, rbY + 34);
    // wind arrow
    const windFrom = Math.atan2(-wind.x, -wind.z) / DEG;
    const wSpd = Math.hypot(wind.x, wind.z);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('WIND ' + ((windFrom % 360 + 360) % 360).toFixed(0) + '° / ' + wSpd.toFixed(0) + ' kt', cx, rbY + 50);

    // ---------- engine instruments (top-left) ----------
    const ex = 18, ey = 20;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('RPM', ex, ey);
    this.bar(ex + 46, ey - 8, 120, 10, ac.rpm / 2400, '#4da3ff');
    ctx.fillText(Math.round(ac.rpm), ex + 172, ey + 1);
    ctx.fillText('THR', ex, ey + 22);
    this.bar(ex + 46, ey + 14, 120, 10, ac.throttle, '#4dff88');
    ctx.fillText(Math.round(ac.throttle * 100) + '%', ex + 172, ey + 23);
    ctx.fillText('FUEL', ex, ey + 44);
    this.bar(ex + 46, ey + 36, 120, 10, ac.fuel / ac.fuelCap, ac.fuel < 25 ? '#ff4d4d' : '#ffd24d');
    ctx.fillText(Math.round(ac.fuel) + ' L', ex + 172, ey + 45);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('FLAP ' + ['UP', '1', '2'][ac.flaps] + '   GEAR ' + (ac.gearDown ? 'DOWN' : 'UP'), ex, ey + 66);

    // ---------- info (top-right) ----------
    ctx.textAlign = 'right';
    const ix = W - 196;
    const zulu = new Date((opts.simHour * 3600 + (opts.simMin || 0) * 60) * 1000);
    const hh = Math.floor(opts.simHour) % 24, mm = Math.floor((opts.simHour % 1) * 60);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + 'Z', ix, ey);
    const lat = 47.0 + (-ac.pos.z) / 111320;
    const lon = 8.0 + ac.pos.x / (111320 * Math.cos(47 * DEG));
    ctx.fillText(lat.toFixed(4) + '°N  ' + lon.toFixed(4) + '°E', ix, ey + 18);
    ctx.fillText('TAS ' + (ac.tas * 1.94384).toFixed(0) + ' kt   ALT ' + Math.round(ac.pos.y * 3.28084) + ' ft', ix, ey + 36);
    ctx.fillText('G ' + ac.loadFactor.toFixed(1) + '   VS ' + (opts.vsi || 0).toFixed(0) + ' fpm', ix, ey + 54);

    // ---------- warnings ----------
    ctx.textAlign = 'center';
    const warns = [];
    if (ac.buffet > 0.25) warns.push('STALL');
    if (ac.overspeed) warns.push('OVERSPEED');
    if (ac.fuel <= 0) warns.push('FUEL EMPTY');
    else if (ac.fuel < 25) warns.push('LOW FUEL');
    if (ac.gearAnim < 0.9 && (ac.onGround || (ac.ias < 95 && ac.pos.y < 500))) warns.push('GEAR');
    if (warns.length) {
      const flash = (performance.now() / 300) % 2 < 1;
      if (flash) {
        ctx.font = 'bold 22px monospace';
        ctx.fillStyle = '#ff4040';
        ctx.fillText(warns.join('   ·   '), cx, 64);
        ctx.font = '12px "JetBrains Mono", Consolas, monospace';
      }
    }

    // ---------- controls hint ----------
    if (this.hintT > 0) {
      this.hintT -= dt;
      ctx.textAlign = 'left';
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, this.hintT / 2)})`;
      ctx.fillText('←→ roll · ↑↓ pitch · A/D rudder · W/S throttle · F flaps · G gear · B brake · C view · P pause · H help', 18, H - 18);
    }
  }

  tape(x, cy, h, value, min, max, step, unit, isSpeed) {
    const ctx = this.ctx;
    const half = h / 2;
    const range = 40; // 可视范围（速度为 m/s，高度为 ft）
    // 速度刻度按 kt 标注（内部以 m/s 定位）
    const s = isSpeed ? step / 1.94384 : step;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 30, cy - half - 6, 60, h + 12);
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    ctx.fill();
    ctx.clip();
    // 失速危险区（Vs 以下红色带）
    if (isSpeed && this.stallKt > 0) {
      const yVs = cy - (this.stallKt / 1.94384 - value) * (h / range);
      ctx.fillStyle = 'rgba(255,60,60,0.28)';
      ctx.fillRect(x - 30, yVs, 60, cy + half + 6 - yVs);
      ctx.strokeStyle = 'rgba(255,80,70,0.9)';
      ctx.beginPath();
      ctx.moveTo(x - 30, yVs);
      ctx.lineTo(x + 30, yVs);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,120,110,0.95)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('VS', x - 28, yVs - 2);
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    const scale = h / range;
    const k0 = Math.ceil((value - range / 2) / s);
    for (let k = k0; k * s <= value + range / 2; k++) {
      const v = k * s;
      if (v < min) continue;
      const y = cy - (v - value) * scale;
      const major = k % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(x - (major ? 14 : 8), y);
      ctx.lineTo(x - 2, y);
      ctx.stroke();
      if (major) ctx.fillText(isSpeed ? Math.round(v * 1.94384).toString() : v.toString(), x - 17, y + 3);
    }
    ctx.restore();
    // current value box
    ctx.fillStyle = 'rgba(8,10,14,0.8)';
    ctx.fillRect(x + 8, cy - 11, 44, 22);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.strokeRect(x + 8, cy - 11, 44, 22);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(isSpeed ? Math.round(value * 1.94384).toString() : Math.round(value).toString(), x + 30, cy + 4);
    ctx.font = '9px monospace';
    ctx.fillText(unit, x + 30, cy + 24);
    ctx.font = '12px "JetBrains Mono", Consolas, monospace';
  }

  bar(x, y, w, h, frac, color) {
    const ctx = this.ctx;
    frac = Math.max(0, Math.min(1, frac));
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * frac, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.strokeRect(x, y, w, h);
  }

  showHint() { this.hintT = 12; }
}

// ---------------- minimap ----------------
export class Minimap {
  constructor(canvas, terrain) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrain = terrain;
    this.size = 172;
    canvas.width = this.size;
    canvas.height = this.size;
    this.range = 6000; // meters shown
  }

  draw(ac, clouds) {
    const ctx = this.ctx;
    const S = this.size;
    const c = S / 2;
    const scale = c / this.range;
    ctx.clearRect(0, 0, S, S);
    // terrain samples
    const N = 42;
    const step = (this.range * 2) / N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ac.pos.x + (i - N / 2) * step;
        const z = ac.pos.z + (j - N / 2) * step;
        const h = this.terrain.height(x, z);
        let col;
        if (h < 0) col = '#1a4a6a';
        else if (h < 4) col = '#c8b078';
        else if (h < 900) col = '#3a5a2e';
        else if (h < 1500) col = '#5a6a4a';
        else if (h < 1900) col = '#7a7a72';
        else col = '#e8eef2';
        ctx.fillStyle = col;
        ctx.fillRect(i * (S / N), j * (S / N), S / N + 0.5, S / N + 0.5);
      }
    }
    // range rings
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    for (const r of [0.33, 0.66, 1]) {
      ctx.beginPath(); ctx.arc(c, c, c * r, 0, Math.PI * 2); ctx.stroke();
    }
    // clouds
    if (clouds) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const cl of clouds.clouds) {
        for (const s of cl.sprites) {
          const dx = (s.position.x - ac.pos.x) * scale;
          const dz = (s.position.z - ac.pos.z) * scale;
          if (Math.abs(dx) < c && Math.abs(dz) < c) {
            const r = Math.max(1.5, s.scale.x * scale * 0.5);
            ctx.beginPath();
            ctx.arc(c + dx, c + dz, Math.min(r, 12), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    // runway (runs north from spawn)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    const rx = (0 - ac.pos.x) * scale;
    ctx.beginPath();
    ctx.moveTo(c + rx, c + (160 - ac.pos.z) * scale);
    ctx.lineTo(c + rx, c + (-980 - ac.pos.z) * scale);
    ctx.stroke();

    // aircraft arrow (north-up, rotate by heading)
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-ac.heading * DEG + Math.PI);
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // heading tick (N marker)
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', c, 12);
  }
}
