// Sky dome (atmospheric scattering approximation), sun light, environment map
import * as THREE from 'three';
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['sky'] = true;

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;

    // ---- sky dome
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
        uDay: { value: 1 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uTurb: { value: 2 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w; // push to far plane
        }`,
      fragmentShader: `
        uniform vec3 uSunDir, uSunColor;
        uniform float uDay, uTime, uFlash, uTurb;
        varying vec3 vDir;
        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        }
        void main() {
          vec3 dir = normalize(vDir);
          float y = dir.y;
          vec3 zen = mix(vec3(0.015, 0.03, 0.09), vec3(0.22, 0.42, 0.82), uDay);
          vec3 hor = mix(vec3(0.05, 0.06, 0.13), vec3(0.78, 0.84, 0.90), uDay);
          // horizon haze band
          float t = pow(max(y, 0.0), 0.55);
          vec3 col = mix(hor, zen, t);
          col = mix(col, hor * 0.55, smoothstep(0.02, -0.2, y));
          // sun
          float s = max(dot(dir, uSunDir), 0.0);
          float disc = pow(s, 900.0) * 4.0;
          float halo = pow(s, 18.0) * 0.30 * uDay;
          float lowGlow = pow(s, 3.0) * (1.0 - abs(uSunDir.y)) * 0.4 * uDay;
          col += uSunColor * (disc + halo);
          col += vec3(1.0, 0.5, 0.22) * lowGlow;
          // high cloud-free sky variation
          col *= 1.0 + (hash(floor(dir * 300.0)) - 0.5) * 0.015 * uTurb;
          // stars
          float night = 1.0 - uDay;
          if (night > 0.04 && y > 0.005) {
            vec3 g = floor(dir * 240.0);
            float h = hash(g);
            float star = step(0.9982, h);
            float tw = 0.55 + 0.45 * sin(uTime * 2.5 + h * 90.0);
            col += vec3(0.85, 0.9, 1.0) * star * tw * night * smoothstep(0.0, 0.12, y);
          }
          // lightning flash
          col += vec3(0.55, 0.62, 0.85) * uFlash;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const domeGeo = new THREE.SphereGeometry(38000, 40, 24);
    this.dome = new THREE.Mesh(domeGeo, this.mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    scene.add(this.dome);

    // ---- lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -450; sc.right = 450; sc.top = 450; sc.bottom = -450;
    sc.near = 1; sc.far = 5000;
    sc.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x3a4a3a, 0.7);
    scene.add(this.hemi);

    // ---- environment map (for PBR reflections)
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 20), this.mat);
    this.envScene.add(this.envDome);
    this.envTimer = 0;
    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._sunColor = new THREE.Color(1, 0.96, 0.9);
    this._horizon = new THREE.Color(0.78, 0.84, 0.9);
    this.dayFactor = 1;
    // initial environment map (so PBR materials have reflections immediately)
    this.envTex = this.pmrem.fromScene(this.envScene, 0.04).texture;
    this.scene.environment = this.envTex;
  }

  // hour: 0-24 local; returns sun direction
  update(hour, time, dt, weather, anchor = null) {
    const el = Math.sin((hour - 6) / 12 * Math.PI) * 65 * Math.PI / 180;
    const az = (180 + (hour - 12) * 15) * Math.PI / 180;
    const sd = this._sunDir;
    sd.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();

    const day = THREE.MathUtils.smoothstep(el, -0.07, 0.14);
    this.dayFactor = day;

    // sun color: white high, warm low
    const warm = 1 - THREE.MathUtils.smoothstep(el, 0.02, 0.45);
    this._sunColor.setRGB(
      1.0,
      0.96 - warm * 0.35,
      0.90 - warm * 0.55
    ).multiplyScalar(weather.sunDim);

    // horizon color
    this._horizon.setRGB(
      0.78 - warm * 0.25,
      0.84 - warm * 0.28,
      0.90 - warm * 0.18
    ).multiplyScalar(0.35 + 0.65 * day * weather.sunDim + (1 - day) * 0.06);

    const u = this.mat.uniforms;
    u.uSunDir.value.copy(sd);
    u.uSunColor.value.copy(this._sunColor);
    u.uDay.value = day;
    u.uTime.value = time;
    u.uTurb.value = weather.turb;

    // sun light (follows anchor so shadows track the aircraft)
    const anchorPos = anchor || this._sunDir; // fallback: direction (title screen)
    if (el > -0.06) {
      this.sun.position.copy(sd).multiplyScalar(2200).add(anchorPos);
      this.sun.color.copy(this._sunColor);
      this.sun.intensity = 3.1 * THREE.MathUtils.smoothstep(el, -0.03, 0.1) * weather.sunDim;
    } else {
      // moonlight
      this.sun.position.copy(sd).multiplyScalar(-2200).add(anchorPos);
      this.sun.color.setRGB(0.55, 0.65, 0.85);
      this.sun.intensity = 0.22;
    }
    this.sun.target.position.copy(anchorPos);
    this.sun.target.updateMatrixWorld();
    this.hemi.intensity = 0.08 + day * 0.65 * weather.sunDim;
    this.hemi.color.setRGB(
      0.55 + 0.45 * day, 0.62 + 0.38 * day, 0.85
    ).multiplyScalar(0.4 + 0.6 * weather.sunDim);

    // environment map refresh (throttled)
    this.envTimer += dt;
    if (this.envTimer > 12) {
      this.envTimer = 0;
      if (this.envTex) this.envTex.dispose();
      this.envTex = this.pmrem.fromScene(this.envScene, 0.04).texture;
      this.scene.environment = this.envTex;
    }
  }

  setFlash(v) { this.mat.uniforms.uFlash.value = v; }

  get sunDir() { return this._sunDir; }
  get sunColor() { return this._sunColor; }
  get horizonColor() { return this._horizon; }

  dispose() {
    this.pmrem.dispose();
  }
}
