import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import WebTorrent from "webtorrent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Adjust this if server.js doesn't live one level above /docs in your layout.
// e.g. if server.js is at repo root: DOCS_DIR = path.join(__dirname, "docs")
// if server.js is at bridge/server.js: DOCS_DIR = path.join(__dirname, "..", "docs")
const DOCS_DIR = path.join(__dirname, "..", "docs");

const PORT = process.env.PORT || 9001;

const client = new WebTorrent({
  maxConns: 60,
});

const torrents = new Map();
const probeCache = new Map();

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function getTorrent(infoHash) {
  if (torrents.has(infoHash)) {
    return Promise.resolve(torrents.get(infoHash));
  }

  return new Promise((resolve, reject) => {
    client.add(
      `magnet:?xt=urn:btih:${infoHash}`,
      {},
      (torrent) => {
        torrents.set(infoHash, torrent);
        resolve(torrent);
      }
    );

    setTimeout(() => {
      if (!torrents.has(infoHash)) {
        reject(new Error("Torrent add timeout"));
      }
    }, 120000);
  });
}

function pickFile(torrent, fileIdx) {
  const files = torrent.files;

  if (fileIdx !== null && fileIdx !== undefined && files[fileIdx]) {
    return files[fileIdx];
  }

  const videos = files.filter((f) =>
    /\.(mp4|m4v|mkv|webm|avi|mov)$/i.test(f.name)
  );

  if (videos.length) {
    return videos.sort((a, b) => b.length - a.length)[0];
  }

  return files.sort((a, b) => b.length - a.length)[0];
}

function probeFile(cacheKey, file) {
  if (probeCache.has(cacheKey)) {
    return probeCache.get(cacheKey);
  }

  const promise = new Promise((resolve) => {
    const probeBytes = Math.min(file.length, 20 * 1024 * 1024);
    const sampleStream = file.createReadStream({ start: 0, end: probeBytes - 1 });

    const ffprobe = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name",
      "-of", "json",
      "-i", "pipe:0",
    ]);

    let out = "";
    let errOut = "";

    ffprobe.stdout.on("data", (d) => (out += d));
    ffprobe.stderr.on("data", (d) => (errOut += d));

    sampleStream.pipe(ffprobe.stdin);
    sampleStream.on("error", () => {});

    ffprobe.on("close", () => {
      try {
        const parsed = JSON.parse(out);
        const streams = parsed.streams || [];
        const videoStream = streams.find((s) => s.codec_type === "video");
        const audioStream = streams.find((s) => s.codec_type === "audio");

        resolve({
          videoCodec: videoStream?.codec_name || null,
          audioCodec: audioStream?.codec_name || null,
        });
      } catch (e) {
        console.error("ffprobe parse failed:", errOut || e.message);
        resolve({ videoCodec: null, audioCodec: null });
      }
    });

    ffprobe.on("error", () => {
      resolve({ videoCodec: null, audioCodec: null });
    });
  });

  probeCache.set(cacheKey, promise);
  return promise;
}

const PS5_OK_VIDEO = new Set(["h264"]);
const PS5_OK_AUDIO = new Set(["aac"]);

function buildFfmpegArgs({ videoCodec, audioCodec }) {
  const videoArgs =
    videoCodec && PS5_OK_VIDEO.has(videoCodec)
      ? ["-c:v", "copy"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];

  const audioArgs =
    audioCodec && PS5_OK_AUDIO.has(audioCodec)
      ? ["-c:a", "copy"]
      : ["-c:a", "aac", "-b:a", "192k"];

  return [
    "-i", "pipe:0",
    ...videoArgs,
    ...audioArgs,
    "-f", "mp4",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-max_muxing_queue_size", "1024",
    "pipe:1",
  ];
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(DOCS_DIR, urlPath);

  // prevent path traversal outside DOCS_DIR
  if (!filePath.startsWith(DOCS_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      return res.end("Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = STATIC_MIME[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleStream(req, res, match) {
  const infoHash = match[1].toLowerCase();
  const fileIdx = match[2] !== undefined ? Number(match[2]) : null;

  console.log("Incoming hash:", infoHash, "file:", fileIdx);

  try {
    const torrent = await getTorrent(infoHash);
    const file = pickFile(torrent, fileIdx);
    const cacheKey = `${infoHash}:${file.path}`;

    const { videoCodec, audioCodec } = await probeFile(cacheKey, file);

    console.log(`[${file.name}] video=${videoCodec} audio=${audioCodec}`);

    const needsWork =
      !(videoCodec && PS5_OK_VIDEO.has(videoCodec)) ||
      !(audioCodec && PS5_OK_AUDIO.has(audioCodec)) ||
      /\.(mkv|webm|avi|mov)$/i.test(file.name);

    const range = req.headers.range;
    let start = 0;

    if (range) {
      const parts = range.replace("bytes=", "").split("-");
      start = Number(parts[0]) || 0;
    }

    if (!needsWork) {
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", "video/mp4");

      if (range) {
        const end = file.length - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${file.length}`,
          "Content-Length": end - start + 1,
        });
        file.createReadStream({ start, end }).pipe(res);
      } else {
        res.writeHead(200, { "Content-Length": file.length });
        file.createReadStream().pipe(res);
      }
      return;
    }

    res.setHeader("Content-Type", "video/mp4");
    res.writeHead(200);

    const sourceStream = file.createReadStream({ start, end: file.length - 1 });
    const ffmpegArgs = buildFfmpegArgs({ videoCodec, audioCodec });
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    sourceStream.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on("data", (d) => process.stderr.write(d));

    const cleanup = () => {
      sourceStream.destroy();
      ffmpeg.kill("SIGKILL");
    };

    req.on("close", cleanup);
    res.on("close", cleanup);
    ffmpeg.on("error", (err) => {
      console.error("ffmpeg spawn error:", err);
      cleanup();
    });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end(`Bridge error: ${err.message}`);
  }
}

const server = http.createServer(async (req, res) => {
  const streamMatch = req.url.match(
    /^\/stream\/([a-fA-F0-9]{40})(?:\?file=(\d+))?$/
  );

  if (streamMatch) {
    return handleStream(req, res, streamMatch);
  }

  // Anything not matching /stream/... is treated as a static asset request
  return serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Stremio PS5 bridge listening on port ${PORT}`);
  console.log(`Serving frontend from: ${DOCS_DIR}`);
  console.log(`Point PS5 browser at: http://<this-machine-ip>:${PORT}/`);
});