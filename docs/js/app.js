"use strict";
/* Views: home, catalog, detail, streams, player, settings, diagnostics. */
const App = (() => {
  const root = document.getElementById("root");
  const hud = document.getElementById("hud");
  const settings = Stremio.loadSettings();
  const state = { view: "home", args: null, stack: [] };
  const CINEMETA = "https://v3-cinemeta.strem.io";

  /* ---------- tiny DOM helpers ---------- */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clear() { root.textContent = ""; }
  function hudMsg(msg, ms) {
    hud.textContent = msg;
    clearTimeout(hudMsg._t);
    if (ms) hudMsg._t = setTimeout(() => { hud.textContent = ""; }, ms);
  }

  /* ---------- navigation ---------- */
  function go(view, args) { state.stack.push({ view: state.view, args: state.args }); show(view, args); }
  function back() { const p = state.stack.pop(); if (p) show(p.view, p.args); }
  function show(view, args) {
    state.view = view; state.args = args;
    const fn = view === "home" ? showHome : view === "catalog" ? showCatalog
      : view === "detail" ? showDetail : view === "streams" ? showStreams
      : view === "player" ? showPlayer : view === "settings" ? showSettings : showDiag;
    fn(args);
  }

  /* ---------- shared widgets ---------- */
  function card(item, onclick) {
    const d = el("div", "card");
    d.setAttribute("data-focus", "");
    d.tabIndex = -1;
    const img = el("div", "thumb");
    if (item.poster) img.style.backgroundImage = "url(" + item.poster + ")";
    const name = el("div", "name", item.name);
    const year = el("div", "year", item.year || item.releaseInfo || "");
    d.append(img, name, year);
    d.addEventListener("click", onclick);
    return d;
  }
  function tile(label, cls, onclick) {
    const t = el("button", "tile " + (cls || ""));
    t.setAttribute("data-focus", "");
    t.textContent = label;
    t.addEventListener("click", onclick);
    return t;
  }
  function keypad(target, done) {
    const kb = el("div", "keyboard");
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -'.&";
    for (const c of chars) {
      const k = el("button", "key", c === " " ? "␣" : c);
      k.setAttribute("data-focus", "");
      k.addEventListener("click", () => { target.value += c; });
      kb.appendChild(k);
    }
    const del = el("button", "key", "⌫");
    del.setAttribute("data-focus", "");
    del.addEventListener("click", () => { target.value = target.value.slice(0, -1); });
    const goBtn = el("button", "key go", "OK");
    goBtn.setAttribute("data-focus", "");
    goBtn.addEventListener("click", () => done(target.value));
    kb.append(del, goBtn);
    return kb;
  }

  /* ---------- HOME ---------- */
  async function showHome() {
    clear();
    state.stack = [];
    const wrap = el("div", "shelves");
    root.appendChild(wrap);

    const utils = el("div", "shelf");
    utils.appendChild(el("h3", "sub", "Stremio"));
    const row = el("div", "cards");
    row.appendChild(tile("🔍 Search", "util", () => show("search")));
    row.appendChild(tile("⚙ Settings", "util", () => show("settings")));
    row.appendChild(tile("ℹ Diagnostics", "util", () => show("diag")));
    utils.appendChild(row);
    wrap.appendChild(utils);

    let rows = [];
    try {
      const m = await Stremio.manifest(CINEMETA);
      rows = (m.catalogs || []).filter(c => !(c.extra || []).some(x => x.isRequired)).slice(0, 5);
    } catch (e) { hudMsg("Cinemeta unreachable: " + e.message, 5000); }

    for (const r of rows) {
      const shelf = el("div", "shelf");
      shelf.appendChild(el("h3", "sub", r.name || r.id));
      const cards = el("div", "cards");
      shelf.appendChild(cards);
      wrap.appendChild(shelf);
      try {
        const metas = await Stremio.catalog(CINEMETA, r.type, r.id, []);
        for (const it of metas) {
          cards.appendChild(card(it, () => go("detail", { type: r.type, id: it.id })));
        }
        if (r.extra && r.extra.some(x => x.name === "skip")) {
          cards.appendChild(tile("More ▸", "more", () => go("catalog", { type: r.type, id: r.id, name: r.name || r.id, skip: 20 })));
        }
      } catch (e) {
        cards.appendChild(el("div", "hint", "Could not load: " + e.message));
      }
    }
    Input.Focus.set(wrap.querySelectorAll("[data-focus]"));
  }

  /* ---------- SEARCH ---------- */
  function showSearch() {
    clear();
    const v = el("div", "view");
    const box = el("input", "searchbox");
    box.placeholder = "Search films & series";
    box.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(box.value); });
    const kb = keypad(box, doSearch);
    const hint = el("div", "hint", "Use the pad grid, or a USB keyboard if you have one.");
    v.append(el("h2", "title", "Search"), box, kb, hint);
    root.appendChild(v);
    Input.Focus.set([box, ...kb.querySelectorAll("[data-focus]")]);
  }
  async function doSearch(q) {
    q = (q || "").trim();
    if (!q) return;
    go("catalog", { type: "movie", id: "top", name: "Results: " + q, search: q });
  }

  /* ---------- CATALOG ---------- */
  async function showCatalog(a) {
    clear();
    root.appendChild(el("h2", "title", a.name || a.id));
    const chips = el("div", "chips");
    if (!a.search) {
      try {
        const m = await Stremio.manifest(CINEMETA);
        const c = (m.catalogs || []).find(x => x.type === a.type && x.id === a.id);
        const genres = c && c.genres ? c.genres.slice(0, 12) : [];
        for (const g of genres) {
          const chip = el("button", "chip", g);
          chip.setAttribute("data-focus", "");
          chip.addEventListener("click", () => go("catalog", Object.assign({}, a, { genre: g, skip: 0 })));
          chips.appendChild(chip);
        }
      } catch (e) {}
    }
    if (chips.childNodes.length) root.appendChild(chips);

    const grid = el("div", "grid");
    root.appendChild(grid);
    const extra = [];
    if (a.search) extra.push({ k: "search", v: a.search });
    if (a.genre) extra.push({ k: "genre", v: a.genre });
    if (a.skip) extra.push({ k: "skip", v: a.skip });
    try {
      const metas = await Stremio.catalog(CINEMETA, a.type, a.id, extra);
      for (const it of metas) grid.appendChild(card(it, () => go("detail", { type: a.type, id: it.id })));
      if (metas.length >= 20) {
        grid.appendChild(tile("More ▸", "more", () => go("catalog", Object.assign({}, a, { skip: (a.skip || 20) + 20 }))));
      }
    } catch (e) {
      grid.appendChild(el("div", "hint", "Could not load: " + e.message));
    }
    grid.appendChild(tile("‹ Back", "backtile", () => back()));
    Input.Focus.set(grid.querySelectorAll("[data-focus]"));
  }

  /* ---------- DETAIL ---------- */
  async function showDetail(a) {
    clear();
    const v = el("div", "view");
    root.appendChild(v);
    v.appendChild(tile("‹ Back", "backtile", () => back()));

    let data = null;
    try { data = await Stremio.meta(CINEMETA, a.type, a.id); } catch (e) {}
    if (!data) {
      v.appendChild(el("div", "hint", "Title not found."));
      Input.Focus.set(v.querySelectorAll("[data-focus]"));
      return;
    }
    state.detail = data;
    const info = el("div", "detail");
    if (data.background) info.style.backgroundImage = "url(" + data.background + ")";
    info.appendChild(el("h2", "title", data.name));
    info.appendChild(el("div", "meta", [data.releaseInfo, data.imdbRating ? "★ " + data.imdbRating : "", (data.genre || []).join(" · ")].filter(Boolean).join("   ")));
    info.appendChild(el("p", "synopsis", data.description || ""));
    v.appendChild(info);

    if (a.type === "movie") {
      const play = tile("▶ Play", "bigbtn", () => go("streams", { type: "movie", id: a.id, name: data.name }));
      v.appendChild(play);
    } else {
      const eps = data.videos || [];
      const seasons = [...new Set(eps.map(e => e.season).filter(s => s))].sort((x, y) => x - y);
      const tabs = el("div", "seasons");
      for (const s of seasons) {
        const t = tile("S" + s, "key", () => renderEpisodes(s));
        tabs.appendChild(t);
      }
      v.appendChild(tabs);
      const epGrid = el("div", "grid small");
      v.appendChild(epGrid);
      function renderEpisodes(season) {
        epGrid.textContent = "";
        const list = eps.filter(e => e.season === season).sort((x, y) => x.episode - y.episode);
        for (const e of list) {
          const c = tile((e.episode ? "E" + e.episode + "  " : "") + (e.name || ""), "ep", () =>
            go("streams", { type: "series", id: Stremio.episodeId(a.id, e.season, e.episode), name: data.name + " · S" + e.season + "E" + e.episode }));
          epGrid.appendChild(c);
        }
        Input.Focus.set(epGrid.querySelectorAll("[data-focus]"));
      }
      if (seasons.length) renderEpisodes(seasons[0]);
      else epGrid.appendChild(el("div", "hint", "No episodes listed."));
    }
    Input.Focus.set(v.querySelectorAll("[data-focus]"));
  }

  /* ---------- STREAMS ---------- */
  async function showStreams(args) {
    clear();
    const v = el("div", "view");
    root.appendChild(v);
    v.appendChild(el("h2", "title", args.name));
    const list = el("div", "streamlist");
    v.appendChild(list);
    hudMsg("Loading streams…", 2000);

    const bridge = Stremio.normalizeBridge(settings.bridge);
    const results = [];
    const errors = [];

    const fetchOne = async (a) => {
      try {
        const sup = await Stremio.supports(a.base, "stream");
        if (sup === false) return;
        const ss = await Stremio.streams(a.base, args.type, args.id, 12000);
        if (ss && ss.length) results.push({ addon: a, streams: Stremio.sortStreams(ss) });
      } catch (e) { errors.push(a.name + " — " + e.message); }
    };
    await Promise.all(settings.addons.map(a => fetchOne(a).catch(() => {})));

    if (!results.length) {
      list.appendChild(el("div", "diag",
        errors.length ? "No streams found.\n" + errors.join("\n") : "No streams found."));
    } else {
      for (const { addon, streams } of results) {
        list.appendChild(el("div", "addonhead", addon.name));
        for (const s of streams) {
          const label = s.title || s.name || "Stream";
          let onclick = null;
          if (s.url) {
            onclick = () => go("player", { src: s.url, name: args.name });
          } else if (s.infoHash) {
            if (!bridge) {
              list.appendChild(el("div", "diag", label + "  (set torrent bridge in ⚙ Settings)"));
              continue;
            }
            const src = bridge + "/stream/" + s.infoHash +
                        (s.fileIdx != null ? "?file=" + s.fileIdx : "");
            onclick = () => go("player", { src: src, name: args.name });
          } else { continue; }
          const t = tile(label, "key", onclick || (() => hudMsg("No playable stream.", 2500)));
          list.appendChild(t);
        }
      }
    }
    v.appendChild(tile("‹ Back", "backtile", () => back()));
    Input.Focus.set(v.querySelectorAll("[data-focus]"));
  }

  function streamRow(s, a, addon) {
    const row = el("button", "stream");
    row.setAttribute("data-focus", "");
    const head = el("div", "shead");
    head.appendChild(el("span", "stitle", s.name || s.title || "Stream"));
    head.appendChild(el("span", "sinfo", (s.title || "").split("\n").pop() || ""));
    const badge = el("span", "badge");
    if (s.url) {
      badge.textContent = "▶ plays here";
      badge.classList.add("ok");
    } else if (settings.bridge) {
      badge.textContent = "▶ via bridge";
      badge.classList.add("ok");
    } else {
      badge.textContent = "torrent — set bridge in Settings";
      badge.classList.add("warn");
    }
    row.append(head, badge);
    row.addEventListener("click", () => {
      if (s.url) {
        play({ src: s.url, name: a.name });
      } else if (settings.bridge) {
        const q = s.fileIdx != null ? "?file=" + s.fileIdx : "";
        play({ src: settings.bridge + "/stream/" + s.infoHash + q, name: a.name });
      } else {
        hudMsg("This is a torrent stream. Add the bridge address in Settings (see README).", 6000);
      }
    });
    return row;
  }

  /* ---------- PLAYER ---------- */
  function play(p) { show("player", p); }
  let playerTimer = null;
  function showPlayer(p) {
    clear();
    const v = el("div", "view player");
    const vid = document.createElement("video");
    vid.src = p.src;
    vid.autoplay = true;
    const overlay = el("div", "overlay", p.name);
    const hint = el("div", "hint", "X pause · ←/→ ±10s · ↑/↓ volume · O exit · R3 fill");
    v.append(vid, overlay, hint);
    root.appendChild(v);

    let resume = 0;
    try { resume = +localStorage.getItem("resume." + p.src) || 0; } catch (e) {}
    if (resume > 30) { try { vid.currentTime = resume; } catch (e) {} }

    const save = () => {
      try {
        if (vid.currentTime > 300) localStorage.setItem("resume." + p.src, Math.floor(vid.currentTime));
        else localStorage.removeItem("resume." + p.src);
      } catch (e) {}
    };
    playerTimer = setInterval(save, 30000);
    vid.addEventListener("ended", () => { clearInterval(playerTimer); save(); });
    vid.addEventListener("error", () => {
      overlay.textContent = "Playback error — codec likely unsupported by PS5 WebKit: " +
        (vid.error ? vid.error.message : "unknown");
    });
  }

  function playerAction(action) {
    const vid = document.querySelector(".player video");
    if (!vid) return;
    const hint = document.querySelector(".player .hint");
    if (action === "back") { clearInterval(playerTimer); back(); }
    else if (action === "ok") { vid.paused ? vid.play() : vid.pause(); }
    else if (action === "left") vid.currentTime = Math.max(0, vid.currentTime - 10);
    else if (action === "right") vid.currentTime += 10;
    else if (action === "up") vid.volume = Math.min(1, vid.volume + 0.1);
    else if (action === "down") vid.volume = Math.max(0, vid.volume - 0.1);
    else if (action === "mute") vid.muted = !vid.muted;
    else if (action === "restart") vid.currentTime = 0;
    else if (action === "fill") {
      try {
        if (vid.requestFullscreen) vid.requestFullscreen();
        else if (vid.webkitEnterFullscreen) vid.webkitEnterFullscreen();
      } catch (e) {}
    }
    if (hint) hint.textContent = "X pause · ←/→ ±10s · ↑/↓ volume · O exit · R3 fill";
  }

  /* ---------- SETTINGS ---------- */
  function showSettings() {
    clear();
    const v = el("div", "view");
    root.appendChild(v);
    v.appendChild(el("h2", "title", "Settings"));

    v.appendChild(el("h3", "sub", "Torrent bridge (for Torrentio streams)"));
    const bridge = el("input", "searchbox");
    bridge.value = settings.bridge || "";
    bridge.placeholder = "192.168.1.5:9001";
    bridge.setAttribute("data-focus", "");
    v.appendChild(bridge);

    v.appendChild(el("h3", "sub", "CORS proxy (fallback for blocked addons)"));
    const proxy = el("input", "searchbox");
    proxy.value = settings.corsProxy || "";
    proxy.placeholder = "https://api.allorigins.win/raw?url=  (empty = off)";
    proxy.setAttribute("data-focus", "");
    v.appendChild(proxy);

    const acc = settings.auth;
    v.appendChild(el("h3", "sub", acc && acc.authKey ? "Stremio account" : "Login to Stremio"));
    if (acc && acc.authKey) {
      const row = el("div", "addonrow");
      row.appendChild(el("span", "", "Logged in"));
      row.appendChild(tile("Load my addons", "key", async () => {
        try {
          const list = await Stremio.accountAddons(acc.authKey);
          settings.addons = list.map(Stremio.fromAccountAddon);
          Stremio.saveSettings(settings);
          hudMsg("Loaded " + list.length + " addons.", 2500);
          show("settings");
        } catch (e) { hudMsg("Addons failed: " + e.message, 4000); }
      }));
      row.appendChild(tile("Log out", "key", () => {
        settings.auth = null;
        Stremio.saveSettings(settings);
        show("settings");
      }));
      v.appendChild(row);
    } else {
      const mail = el("input", "searchbox");
      mail.placeholder = "stremio email";
      const pass = el("input", "searchbox");
      pass.placeholder = "password  (or leave empty → AuthKey mode)";
      const keyIn = el("input", "searchbox");
      keyIn.placeholder = "AuthKey (from web.stremio.com console)";
      v.append(mail, pass, keyIn);
      v.appendChild(keypad(mail, () => {}));
      v.appendChild(keypad(pass, () => {}));
      v.appendChild(keypad(keyIn, () => {}));
      v.appendChild(tile("Login", "bigbtn", async () => {
        try {
          let authKey = keyIn.value.trim();
          if (!authKey) {
            const r = await Stremio.accountLogin(mail.value.trim(), pass.value);
            authKey = r.authKey;
          }
          settings.auth = { authKey: authKey };
          Stremio.saveSettings(settings);
          hudMsg("Logged in. Loading addons…", 2500);
          const list = await Stremio.accountAddons(authKey);
          settings.addons = list.map(Stremio.fromAccountAddon);
          Stremio.saveSettings(settings);
          hudMsg("Logged in, " + list.length + " addons loaded.", 2500);
          show("settings");
        } catch (e) { hudMsg(e.message, 4000); }
      }));
    }

    v.appendChild(el("h3", "sub", "Addons"));
    const alist = el("div", "addonlist");
    for (const a of settings.addons) {
      const row = el("div", "addonrow");
      row.appendChild(el("span", "", a.name + "  (" + a.base + ")"));
      const tog = tile(a.streams ? "streams: ON" : "streams: OFF", "key", () => {
        a.streams = !a.streams;
        Stremio.saveSettings(settings);
        show("settings");
      });
      row.appendChild(tog);
      alist.appendChild(row);
    }
    v.appendChild(alist);

    const saveBtn = tile("Save", "bigbtn", () => {
      settings.bridge = Stremio.normalizeBridge(bridge.value);
      settings.corsProxy = (proxy.value || "").trim();
      Stremio.saveSettings(settings);
      hudMsg("Saved.", 2000);
      back();
    });
    v.appendChild(saveBtn);
    v.appendChild(tile("‹ Back", "backtile", () => back()));
    Input.Focus.set(v.querySelectorAll("[data-focus]"));
  }
  function saveBridge(val) {
    settings.bridge = Stremio.normalizeBridge(val);
    Stremio.saveSettings(settings);
    hudMsg("Bridge saved: " + (settings.bridge || "(none)"), 2500);
    show("settings");
  }
  function saveProxy(val) {
    settings.corsProxy = (val || "").trim();
    Stremio.saveSettings(settings);
    hudMsg("CORS proxy " + (settings.corsProxy ? "saved." : "off."), 2500);
    show("settings");
  }

  /* ---------- DIAGNOSTICS ---------- */
  function canPlay(type) {
    try { return document.createElement("video").canPlayType(type) || "no"; }
    catch (e) { return "?"; }
  }
  function showDiag() {
    clear();
    const v = el("div", "view");
    root.appendChild(v);
    v.appendChild(el("h2", "title", "Diagnostics"));
    const ist = window.InputStats || {};
    const rows = [
      ["WebAssembly", typeof WebAssembly !== "undefined" ? "present (unexpected on PS5)" : "absent — expected, app does not need it"],
      ["MSE (MediaSource)", typeof MediaSource !== "undefined" ? "present" : "absent"],
      ["HLS native", canPlay("application/vnd.apple.mpegurl")],
      ["MP4 / H.264", canPlay('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')],
      ["WebM / VP9", canPlay('video/webm; codecs="vp9"')],
      ["Gamepad API", typeof navigator.getGamepads === "function" ? "present" : "absent"],
      ["Input events", (ist.keydowns || 0) + " keydowns · last: " + (ist.lastAction || ist.lastKey || "-")],
      ["Bridge", settings.bridge || "(not set)"],
      ["CORS proxy", settings.corsProxy || "(off)"],
    ];
    for (const [k, val] of rows) v.appendChild(el("div", "diag", k + ": " + val));
    v.appendChild(tile("‹ Back", "backtile", () => back()));
    Input.Focus.set(v.querySelectorAll("[data-focus]"));
  }

  /* ---------- global input routing ---------- */
  function dispatch(action) {
    if (state.view === "player") return playerAction(action);
    if (action === "back") return back();
    if (action === "ok") return Input.Focus.activate();
    if (action === "up") return Input.Focus.move(0, -1);
    if (action === "down") return Input.Focus.move(0, 1);
    if (action === "left") return Input.Focus.move(-1, 0);
    if (action === "right") return Input.Focus.move(1, 0);
    if (action === "home") return show("home");
    if (action === "refresh") return show(state.view, state.args);
    if (action === "keys") {
      hudMsg(Object.entries(Input.KEYMAP).map(([k, v]) => k + "→" + v).join("  "), 5000);
    }
  }
  Input.setHandler(dispatch);

  /* ---------- clock ---------- */
  setInterval(() => {
    const c = document.getElementById("clock");
    if (c) c.textContent = new Date().toLocaleTimeString();
  }, 30000);

  show("home");
  return { show, go, back, dispatch };
})();