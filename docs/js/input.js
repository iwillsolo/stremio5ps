"use strict";
const Input = (() => {
  /* PS5 media webview: DualSense -> keydown with keyCode.
   * keyCode first (reliable), e.key string as fallback (jsdom/desktop). */
  const KEYCODE = {
    13: "ok", 32: "ok", 27: "back", 8: "back", 461: "back",
    37: "left", 38: "up", 39: "right", 40: "down",
    112: "refresh", 113: "subs", 114: "keys",
    116: "pageup", 117: "pagedown", 118: "first", 119: "last",
    120: "restart", 121: "fill",
    36: "home", 35: "end", 33: "pageup", 34: "pagedown",
    77: "mute", 70: "fill",
  };
  const KEYNAME = {
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

  /* Debug counters, shown in Diagnostics so you can verify the pad on PS5. */
  const stats = { keydowns: 0, lastKey: "", lastAction: "" };
  if (typeof window !== "undefined") window.InputStats = stats;

  /* Hold-to-repeat throttle (svtplay uses ~90ms). */
  const REPEAT_MS = 90;
  const lastEmit = {};
  addEventListener("keydown", (e) => {
    /* PS5 native OSK active: hands off, or Backspace triggers "back"
     * and arrow keys get eaten. Only Escape closes the keyboard. */
    const t = e.target;
    const editing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (editing) {
      if (e.keyCode === 27 || (e.key || "").toLowerCase() === "escape") {
        e.preventDefault();
        t.blur();                    /* first Escape: close OSK, leave the field */
      }
      return;                        /* everything else goes to the field */
    }
    const code = e.keyCode || e.which || 0;
    const key = (e.key || e.code || "").toLowerCase();
    const action = KEYCODE[code] || KEYNAME[key];
    stats.keydowns++;
    stats.lastKey = code ? (code + (key ? ":" + key : "")) : (key || "?");
    if (!action) return;
    const now = Date.now();
    if (lastEmit[action] && (now - lastEmit[action] < REPEAT_MS)) return;
    lastEmit[action] = now;
    stats.lastAction = action;
    e.preventDefault();
    emit(action, e);
  }, true);

  /* ---------- geometric focus engine (unchanged) ---------- */
  const Focus = {
    items: [], idx: -1,
    set(list) {
      let arr = [];
      if (list) {
        if (Array.isArray(list)) arr = list;
        else if (typeof list.length === "number") arr = Array.prototype.slice.call(list);
        else arr = [list];
      }
      this.items = arr.filter(el => el && el.offsetParent !== null);
      if (!this.items.length) { this.idx = -1; return; }
      if (this.idx < 0 || this.idx >= this.items.length) this.idx = 0;
      this.place();
    },
    place() {
      for (let i = 0; i < this.items.length; i++)
        this.items[i].classList.toggle("focused", i === this.idx);
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
    activate() {
      const el = this.current();
      if (!el) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.focus();                  /* summons the PS5 on-screen keyboard */
      } else if (el.click) {
        el.click();
      }
    },
    indexOf(el) { return this.items.indexOf(el); },
    center(el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
  };

  /* ---------- BFpilot-style joystick cursor (Gamepad API) ---------- */
  let timer = null, cursorEl = null, cursorMode = false;
  const cursor = { x: innerWidth / 2, y: innerHeight / 2, speed: 16, dead: 0.22 };
  function ensureCursor() {
    if (cursorEl) return cursorEl;
    cursorEl = document.createElement("div");
    cursorEl.id = "gpad-cursor";
    document.body.appendChild(cursorEl);
    return cursorEl;
  }
  function setCursorMode(on) {
    cursorMode = on;
    const c = ensureCursor();
    c.classList.toggle("on", on);
  }
  function clickAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const f = el && el.closest ? el.closest("[data-focus]") : null;
    if (f && Focus.items.length) {
      const i = Focus.indexOf(f);
      if (i >= 0) { Focus.idx = i; Focus.place(); }
    }
    if (el && el.click) el.click();
  }

  const prev = { up: 0, down: 0, left: 0, right: 0, ok: 0, back: 0, r3: 0 };
  function poll() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    if (!pads) return;
    const g = Array.prototype.find.call(pads, p => p && p.connected);
    if (!g) return;
    const axes = g.axes || [];
    const btn = i => (g.buttons[i] && g.buttons[i].pressed) ? 1 : 0;
    const lx = axes[0] || 0, ly = axes[1] || 0;
    const mag = Math.hypot(lx, ly);

    if (mag > cursor.dead) {
      /* stick moved -> BFpilot-style pointer */
      setCursorMode(true);
      cursor.x = Math.max(0, Math.min(innerWidth,  cursor.x + lx * cursor.speed));
      cursor.y = Math.max(0, Math.min(innerHeight, cursor.y + ly * cursor.speed));
      const c = ensureCursor();
      c.style.left = cursor.x + "px";
      c.style.top  = cursor.y + "px";
    }
    if (cursorMode && btn(0))        { if (!prev.ok)  clickAt(cursor.x, cursor.y); }
    if (cursorMode && btn(1))        { if (!prev.back) emit("back"); }
    if (cursorMode && (btn(9) || btn(8))) { if (!prev.r3) setCursorMode(false); } /* R3/L3 -> back to D-pad */

    if (!cursorMode) {
      const hat = v => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0);
      const now = {
        up: hat(ly) === -1 || btn(12), down: hat(ly) === 1 || btn(13),
        left: hat(lx) === -1 || btn(14), right: hat(lx) === 1 || btn(15),
        ok: btn(0) || btn(2), back: btn(1) || btn(3), r3: btn(9),
      };
      if (now.up && !prev.up) emit("up");
      if (now.down && !prev.down) emit("down");
      if (now.left && !prev.left) emit("left");
      if (now.right && !prev.right) emit("right");
      if (now.ok && !prev.ok) emit("ok");
      if (now.back && !prev.back) emit("back");
      if (now.r3 && !prev.r3) setCursorMode(true);
      Object.assign(prev, now);
    }
  }
  /* Start polling immediately AND on connect — don't wait for the event. */
  function startPolling() {
    if (timer) return;
    timer = setInterval(poll, 33);
    poll();
  }
  if (typeof navigator !== "undefined" && navigator.getGamepads) startPolling();
  addEventListener("gamepadconnected", startPolling);

  return { setHandler, emit, Focus, KEYCODE, KEYNAME, setCursorMode };
})();