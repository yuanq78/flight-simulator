// WebAudio: engine, wind, buffet, rain, thunder, clicks
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['audio'] = true;

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
  }

  init() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      brown = (brown + 0.02 * w) / 1.02;
      d[i] = w;
    }
    this.whiteBuf = this.noiseBuf;
    const brownLen = this.ctx.sampleRate * 2;
    this.brownBuf = this.ctx.createBuffer(1, brownLen, this.ctx.sampleRate);
    const bd = this.brownBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < brownLen; i++) {
      b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      bd[i] = b * 3.5;
    }

    // ---- engine: two oscillators + noise through lowpass
    this.engGain = this.ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = this.ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 400;
    this.osc1 = this.ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = this.ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc1.frequency.value = 80;
    this.osc2.frequency.value = 40;
    const o2g = this.ctx.createGain();
    o2g.gain.value = 0.5;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g);
    o2g.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // prop noise
    this.propGain = this.ctx.createGain();
    this.propGain.gain.value = 0;
    const propSrc = this.loopNoise();
    const propFilter = this.ctx.createBiquadFilter();
    propFilter.type = 'bandpass';
    propFilter.frequency.value = 500;
    propFilter.Q.value = 0.8;
    propSrc.connect(propFilter);
    propFilter.connect(this.propGain);
    this.propGain.connect(this.master);

    // ---- wind
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    const windSrc = this.loopNoise();
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 1.2;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);

    // ---- buffet (stall rumble)
    this.buffetGain = this.ctx.createGain();
    this.buffetGain.gain.value = 0;
    const bufSrc = this.loopNoise();
    const bufFilter = this.ctx.createBiquadFilter();
    bufFilter.type = 'lowpass';
    bufFilter.frequency.value = 130;
    bufSrc.connect(bufFilter);
    bufFilter.connect(this.buffetGain);
    this.buffetGain.connect(this.master);

    // ---- rain
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    const rainSrc = this.loopNoise();
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1400;
    rainSrc.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.master);

    this.started = true;
  }

  loopNoise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    src.loop = true;
    src.start();
    return src;
  }

  update(ac, dt, weather) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const rpmFrac = ac.rpm / 2400;
    // engine
    const engineOn = ac.fuel > 0 && ac.throttle > 0.02;
    const targetEng = engineOn ? 0.05 + rpmFrac * 0.16 : 0;
    this.engGain.gain.setTargetAtTime(this.muted ? 0 : targetEng, t, 0.1);
    const firing = 40 + rpmFrac * 150;
    this.osc1.frequency.setTargetAtTime(firing * 2.2, t, 0.08);
    this.osc2.frequency.setTargetAtTime(firing, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(250 + rpmFrac * 900, t, 0.1);
    this.propGain.gain.setTargetAtTime(
      this.muted ? 0 : (engineOn ? rpmFrac * rpmFrac * 0.20 : 0.015), t, 0.1);
    // wind
    const vFrac = Math.min(1, ac.tas / 110);
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : vFrac * vFrac * 0.34, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(250 + ac.tas * 9, t, 0.2);
    // buffet
    const b = ac.buffet > 0.3 ? (ac.buffet - 0.3) * 0.5 * (0.7 + Math.random() * 0.6) : 0;
    this.buffetGain.gain.setTargetAtTime(this.muted ? 0 : b, t, 0.05);
    // rain
    const rain = weather.rain ? 0.10 : 0;
    this.rainGain.gain.setTargetAtTime(this.muted ? 0 : rain, t, 0.4);
  }

  thunder(delay) {
    if (!this.started || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    src.playbackRate.value = 0.4 + Math.random() * 0.2;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 90 + Math.random() * 80;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.55 + Math.random() * 0.3, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.5 + Math.random() * 2);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + 6);
  }

  click() {
    if (!this.started || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  crashSound() {
    if (!this.started || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + 1.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 2);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
    return this.muted;
  }
}
