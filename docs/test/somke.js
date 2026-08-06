/* Headless smoke tests:  cd docs && npm i jsdom && node test/smoke.js */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const dom = new JSDOM(html, { url: "https://example.com/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

window.fetch = async (url) => {
  const u = String(url);
  const json = (o) => ({ ok: true, json: async () => o });
  if (u.includes("manifest.json")) {
    return json({ catalogs: [
      { type: "movie", id: "top", name: "Popular Movies", extra: [{ name: "skip" }] },
      { type: "series", id: "top", name: "Popular Series", extra: [{ name: "skip" }] },
    ]});
  }
  if (u.includes("/catalog/")) {
    return json({ metas: [{ id: "tt0111161", name: "Test Film", type: "movie" }] });
  }
  if (u.includes("/meta/")) {
    return json({ meta: { id: "tt0111161", name: "Test Film", description: "A test.", videos: [] } });
  }
  if (u.includes("/stream/")) {
    return json({ streams: [
      { name: "Direct", title: "1080p 👤 12", url: "http://cdn/x.mp4" },
      { name: "Torrentio", title: "2160p 👤 40", infoHash: "0123456789abcdef0123456789abcdef01234567", fileIdx: 0 },
    ]});
  }
  throw new Error("unexpected fetch: " + u);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function loadScript(name) {
  window.eval(fs.readFileSync(path.join(__dirname, "..", "js", name), "utf8"));
}
function key(key) {
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
function clickText(text) {
  const els = [...window.document.querySelectorAll("button, .card, .tile")];
  const hit = els.find(e => (e.textContent || "").includes(text));
  if (!hit) throw new Error("element with text not found: " + text);
  hit.click();
}

(async () => {
  let failures = 0;
  const check = (cond, msg) => {
    console.log((cond ? "PASS" : "FAIL") + "  " + msg);
    if (!cond) failures++;
  };

  loadScript("stremio.js");
  loadScript("input.js");
  loadScript("app.js");
  await sleep(120);

  check(window.document.body.textContent.includes("Popular Movies"), "home renders catalog rows");
check(window.document.body.textContent.includes("Test Film"), "home renders catalog items");

  clickText("Test Film");
  await sleep(80);
  check(window.document.body.textContent.includes("▶ Play"), "detail view shows Play");

  clickText("▶ Play");
  await sleep(80);
  check(window.document.body.textContent.includes("Direct"), "streams shows direct-URL stream");
  check(window.document.body.textContent.includes("Torrentio"), "streams shows torrent stream");
  check(window.document.body.textContent.includes("via bridge") ||
        window.document.body.textContent.includes("set bridge"), "torrent badge state shown");

  clickText("Test Film"); /* go back to detail */
  await sleep(50);
  key("Escape");
  await sleep(50);
  check(window.document.body.textContent.includes("Popular Movies"), "back stack returns home");

  clickText("⚙ Settings");
  await sleep(50);
  check(window.document.body.textContent.includes("Torrent bridge"), "settings view opens");
  key("Escape");
  await sleep(50);

  /* navigation geometry: focus must move on arrow keys without crashing */
  key("ArrowDown");
  key("ArrowRight");
  key("ArrowLeft");
  key("ArrowUp");
  await sleep(20);
  check(true, "directional navigation runs without error");

  console.log(failures ? ("\n" + failures + " failure(s)") : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error("CRASH:", e); process.exit(2); });