"use strict";
/* Torrent bridge for the Stremio PS5 webapp.
 * Converts a torrent infoHash into a ranged HTTP stream so the PS5's
 * <video> element can play it directly (the console webview has no
 * WebRTC and no WebAssembly, so torrents cannot play in-page).
 *
 *   npm install && node server.js            # listens on 0.0.0.0:9001
 *   curl "http://127.0.0.1:9001/stream/<infoHash>"       # first file
 *   curl "http://127.0.0.1:9001/stream/<infoHash>?file=3"  # 4th file
 */
const http = require("http");
const WebTorrent = require("webtorrent");
const PORT = process.env.PORT || 9001;
const client = new WebTorrent({ maxConns: 60 });

const torrents = new Map(); /* infoHash -> torrent */

function getTorrent(infoHash) {
  if (torrents.has(infoHash)) return Promise.resolve(torrents.get(infoHash));
  return new Promise((resolve, reject) => {
    client.add("magnet:?xt=urn:btih:" + infoHash, { announce: ["wss://tracker.openwebtorrent.com"] }, t => {
      torrents.set(infoHash, t);
      resolve(t);
    });
    setTimeout(() => { if (!torrents.has(infoHash)) reject(new Error("torrent add timeout")); }, 120000);
  });
}

function pickFile(torrent, fileIdx) {
  const files = torrent.files;
  if (fileIdx != null && files[fileIdx]) return files[fileIdx];
  const video = files.filter(f => /\.(mp4|m4v|mkv|webm|avi|mov)$/i.test(f.name));
  if (video.length) return video.sort((a, b) => b.length - a.length)[0];
  return files.sort((a, b) => b.length - a.length)[0];
}

const server = http.createServer(async (req, res) => {
  const m = req.url.match(/^\/stream\/([a-fA-F0-9]{40})(?:\?file=(\d+))?/);
  if (!m) { res.writeHead(404); return res.end("not found"); }
  const infoHash = m[1].toLowerCase();
  const fileIdx = m[2] != null ? +m[2] : null;
  try {
    const torrent = await getTorrent(infoHash);
    const file = pickFile(torrent, fileIdx);
    const range = req.headers.range;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", "video/mp4");
    if (range) {
      const [start, end] = range.replace(/bytes=/, "").split("-").map(Number);
      const s = start || 0;
      const e = Math.min(end || file.length - 1, file.length - 1);
      res.writeHead(206, { "Content-Range": "bytes " + s + "-" + e + "/" + file.length, "Content-Length": e - s + 1 });
      file.createReadStream({ start: s, end: e }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Length": file.length });
      file.createReadStream().pipe(res);
    }
  } catch (err) {
    res.writeHead(500);
    res.end("bridge error: " + err.message);
  }
});

server.listen(PORT, "0.0.0.0", () => console.log("stremio-ps5 bridge on :" + PORT));