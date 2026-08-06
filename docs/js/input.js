"use strict";
/* DualSense handling. On the PS5 the webview translates pad presses into
 * keyboard events (this is how the svtplay webapp works); we also poll the
 * Gamepad API in case it is exposed. */
const Input = (() => {
  const KEYMAP = {
    "arrowup": "up", "arrowdown": "down", "arrowleft": "left", "arrowright": "right",
    "enter": "ok", " ": "ok", "escape": "back", "backspace": "back",
    "f1": "refresh", "f2": "subs", "f3": "keys", "f5": "pageup", "f6": "pagedown",
    "f7": "first", "f8": "last", "f9": "restart", "f10": "fill",
    "home": "home", "end": "end", "pageup": "pageup", "pagedown": "pagedown",
    "m": "mute", "f": "fill",
  };

  let handler = null;
  function setHandler(fn) { handler = fn; }
  function emit(action, e) {
    if (handler) { try { handler(action, e); } catch (err) { console.error(err); } }
  }

  addEventListener("keydown", (e) => {
    const key = (e.key || e.code || "").toLowerCase();
    const action = KEYMAP[key];
    if (action) { e.preventDefault(); emit(action, e); }
  });

  /* Geometric focus engine: nearest element in the pressed direction,
   * heavily penalizing sideways drift. One rule drives all layouts. */
  const Focus = {
    items: [],
    idx: -1,

    set(list) {
      this.items = (list || []).filter(el => el && el.offsetParent !== null);
      if (!this.items.length) { this.idx = -1; return; }
      if (this.idx < 0 || this.idx >= this.items.length) this.idx = 0;
      this.place();
    },
    place() {
      for (let i = 0; i < this.items.length; i++) {
        this.items[i].classList.toggle("focused", i === this.idx);
      }
      const el = this.items[this.idx];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    current() { return this.items[this.idx]; },
    move(dx, dy) {
      if (!this.items.length) return;
      const cur = this.center(this.items[this.idx]);
      let best = -1, bestScore = Infinity;
      for (let i = 0; i < this.items.length; i++) {
        if (i === this.idx) continue;
        const c = this.center(this.items[i]);
        const adx = c.x - cur.x, ady = c.y - cur.y;
        if (dx > 0 && adx <= 0) continue;
        if (dx < 0 && adx >= 0) continue;
        if (dy > 0 && ady <= 0) continue;
        if (dy < 0 && ady >= 0) continue;
        const straight = Math.abs(dx ? adx : ady);
        const drift = dx ? Math.abs(ady) : Math.abs(adx);
        const score = straight + drift * 3;
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best >= 0) { this.idx = best; this.place(); }
    },
    activate() { const el = this.current(); if (el && el.click) el.click(); },
    center(el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
  };

  /* Gamepad polling (works when navigator.getGamepads exists). */
  let timer = null;
  const prev = { up: 0, down: 0, left: 0, right: 0, ok: 0, back: 0 };
  function poll() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    if (!pads) return;
    const g = Array.prototype.find.call(pads, p => p);
    if (!g) return;
    const hat = v => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0);
    const btn = i => (g.buttons[i] && g.buttons[i].pressed) ? 1 : 0;
    const now = {
      up: hat(g.axes[1]) === -1 || btn(12),
      down: hat(g.axes[1]) === 1 || btn(13),
      left: hat(g.axes[0]) === -1 || btn(14),
      right: hat(g.axes[0]) === 1 || btn(15),
      ok: btn(0) || btn(2),
      back: btn(1) || btn(3),
    };
    if (now.up && !prev.up) emit("up");
    if (now.down && !prev.down) emit("down");
    if (now.left && !prev.left) emit("left");
    if (now.right && !prev.right) emit("right");
    if (now.ok && !prev.ok) emit("ok");
    if (now.back && !prev.back) emit("back");
    Object.assign(prev, now);
  }
  addEventListener("gamepadconnected", () => { if (!timer) timer = setInterval(poll, 80); });

  return { setHandler, emit, Focus, KEYMAP };
})();