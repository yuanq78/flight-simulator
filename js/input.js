// Keyboard / mouse / gamepad input
window.__modLoaded = window.__modLoaded || {}; window.__modLoaded['input'] = true;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.throttle = 0;
    this.events = [];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseLook = false;   // pointer locked
    this.dragging = false;
    this.lastDrag = { x: 0, y: 0 };
    this.pad = null;
    this.invertPitch = false;   // true: ↓=抬头（模拟“拉杆向后”）
    this.lastSt = { pitch: 0, roll: 0, rudder: 0, brake: false, throttle: 0 };

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.events.push({ type: 'key', code: e.code, shiftKey: e.shiftKey });
      // prevent scroll keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
        e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('click', () => {
      if (!this.mouseLook && this.allowLock) {
        canvas.requestPointerLock?.();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.mouseLook = document.pointerLockElement === canvas;
    });
    addEventListener('mousemove', (e) => {
      if (this.mouseLook) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      } else if (this.dragging) {
        this.mouseDX += e.clientX - this.lastDrag.x;
        this.mouseDY += e.clientY - this.lastDrag.y;
        this.lastDrag.x = e.clientX;
        this.lastDrag.y = e.clientY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.mouseLook) {
        this.dragging = true;
        this.lastDrag.x = e.clientX;
        this.lastDrag.y = e.clientY;
      }
    });
    addEventListener('mouseup', () => { this.dragging = false; });

    addEventListener('gamepadconnected', (e) => { this.pad = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this.pad = null; });
  }

  poll() {
    const k = this.keys;
    const inv = this.invertPitch ? -1 : 1;
    const st = {
      pitch: ((k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0)) * inv,
      roll: (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0),
      rudder: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      brake: k.has('KeyB'),
    };
    // throttle
    if (k.has('KeyW')) this.throttle = Math.min(1, this.throttle + 0.45 * 0.016);
    if (k.has('KeyS')) this.throttle = Math.max(0, this.throttle - 0.45 * 0.016);
    st.throttle = this.throttle;

    // gamepad
    if (this.pad !== null) {
      const pads = navigator.getGamepads?.() || [];
      const gp = pads[this.pad];
      if (gp) {
        const dz = (v) => Math.abs(v) > 0.08 ? v : 0;
        st.roll += -dz(gp.axes[0] || 0);
        st.pitch += -dz(gp.axes[1] || 0);
        st.rudder += dz(gp.axes[2] || 0) * 0.8;
        const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
        if (rt > 0.02 || lt > 0.02) this.throttle = Math.max(0, Math.min(1, this.throttle + (rt - lt) * 0.02));
        st.throttle = this.throttle;
        if (gp.buttons[0]?.pressed) this.events.push({ type: 'action', action: 'gear' });
        if (gp.buttons[1]?.pressed) this.events.push({ type: 'action', action: 'flaps' });
        if (gp.buttons[2]?.pressed) st.brake = true;
        if (gp.buttons[3]?.pressed) this.events.push({ type: 'action', action: 'camera' });
        if (gp.buttons[9]?.pressed) this.events.push({ type: 'action', action: 'pause' });
      }
    }
    this.lastSt = st;
    return st;
  }

  // mouse look deltas (consumed by camera)
  takeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  takeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}
