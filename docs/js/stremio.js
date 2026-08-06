"use strict";
/* Stremio HTTP addon-protocol client.
 * Deliberately free of WebAssembly / Web Workers / MSE: the PS5 webview
 * exposes no `WebAssembly` global (that is why web.strem.com cannot run). */
const Stremio = (() => {
  const SETTINGS_KEY = "stremio.ps5.settings";
  const API_BASE = "https://api.strem.io/api";

  const DEFAULTS = {
    bridge: "",                                  /* e.g. http://192.168.1.20:9001 */
    addons: [
      { id: "cinemeta",  name: "Cinemeta",  base: "https://v3-cinemeta.strem.io", streams: false },
      { id: "torrentio", name: "Torrentio", base: "https://torrentio.strem.fun",  streams: true  },
    ],
  };

  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  async function getJSON(url, timeout) {
    const t = timeout || 15000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), t);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } catch (e) {
      throw new Error("network: " + url);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
    return res.json();
  }

  /* /catalog/{type}/{id}/{extra}.json  (extra: k=v&k=v) */
  function catalogUrl(base, type, id, extra) {
    let u = base + "/catalog/" + type + "/" + id;
    if (extra && extra.length) u += "/" + extra.map(e => e.k + "=" + encodeURIComponent(e.v)).join("&");
    return u + ".json";
  }
  async function catalog(base, type, id, extra) {
    const j = await getJSON(catalogUrl(base, type, id, extra));
    return j.metas || [];
  }
  async function meta(base, type, id) {
    const j = await getJSON(base + "/meta/" + type + "/" + id + ".json");
    return j.meta || null;
  }
  async function streams(base, type, id) {
    const j = await getJSON(base + "/stream/" + type + "/" + id + ".json");
    return j.streams || [];
  }
  async function manifest(base) {
    return getJSON(base + "/manifest.json");
  }

  async function apiPost(path, body, timeout) {
    const t = timeout || 20000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), t);
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new Error("network: " + API_BASE + path);
    } finally { clearTimeout(timer); }
    if (!res.ok) throw new Error("HTTP " + res.status + " " + path);
    return res.json();
  }

  /* returns { authKey, user } from email+password */
  async function accountLogin(email, password) {
    const j = await apiPost("/login", { type: "Login", email, password, facebook: false });
    if (!j.result || !j.result.authKey) {
      throw new Error("Login failed — wrong email/password, or account has no password (use AuthKey instead).");
    }
    return j.result;
  }

  /* returns the addon collection array for an authKey */
  async function accountAddons(authKey) {
    const j = await apiPost("/addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
    if (!j.result) throw new Error("addonCollectionGet failed: " + JSON.stringify(j.error || j));
    return j.result.addons || [];
  }

  /* account addon -> your settings.addons entry */
  function fromAccountAddon(a) {
    let base = (a.transportUrl || "").replace(/\/manifest\.json$/, "");
    return {
      id: a.id || base,
      name: a.name || a.transportName || base,
      base: base,
      streams: (a.resources || []).includes("stream"),
    };
  }

  function episodeId(seriesId, season, episode) { return seriesId + ":" + season + ":" + episode; }
  function parseEpisodeId(id) {
    const p = id.split(":");
    return { series: p[0], season: +p[1], episode: +p[2] };
  }

  function qualityRank(s) {
    const t = (s.title || "").toLowerCase();
    if (/2160|4k|uhd/.test(t)) return 0;
    if (/1080/.test(t)) return 1;
    if (/720/.test(t)) return 2;
    return 3;
  }
  function seeds(s) {
    const m = (s.title || "").match(/👤\s*(\d+)/);
    return m ? +m[1] : 0;
  }
  /* Direct-URL streams first, then resolution, then seeders. */
  function sortStreams(list) {
    return list.slice().sort((a, b) => {
      const ad = a.url ? 0 : 1, bd = b.url ? 0 : 1;
      if (ad !== bd) return ad - bd;
      const q = qualityRank(a) - qualityRank(b);
      if (q !== 0) return q;
      return seeds(b) - seeds(a);
    });
  }

  return {
    DEFAULTS, loadSettings, saveSettings, getJSON,
    catalog, catalogUrl, meta, streams, manifest,
    apiPost, accountLogin, accountAddons, fromAccountAddon,
    episodeId, parseEpisodeId, sortStreams,
  };
})();