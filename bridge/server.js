import http from "node:http";
import WebTorrent from "webtorrent";

const PORT = process.env.PORT || 9001;

const client = new WebTorrent({
  maxConns: 60,
});

const torrents = new Map();

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

  if (
    fileIdx !== null &&
    fileIdx !== undefined &&
    files[fileIdx]
  ) {
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

function getMimeType(filename) {
  const ext = filename.split(".").pop().toLowerCase();

  switch (ext) {
    case "mp4":
    case "m4v":
      return "video/mp4";

    case "mkv":
      return "video/x-matroska";

    case "webm":
      return "video/webm";

    case "avi":
      return "video/x-msvideo";

    case "mov":
      return "video/quicktime";

    default:
      return "application/octet-stream";
  }
}

const server = http.createServer(async (req, res) => {
  const match = req.url.match(
    /^\/stream\/([a-fA-F0-9]{40})(?:\?file=(\d+))?$/
  );

  if (!match) {
    res.writeHead(404);
    return res.end("Not Found");
  }

  const infoHash = match[1].toLowerCase();
  const fileIdx = match[2] !== undefined ? Number(match[2]) : null;

  try {
    const torrent = await getTorrent(infoHash);
    const file = pickFile(torrent, fileIdx);

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", getMimeType(file.name));

    const range = req.headers.range;

    if (range) {
      const parts = range.replace("bytes=", "").split("-");

      const start = Number(parts[0]) || 0;
      const end = parts[1]
        ? Number(parts[1])
        : file.length - 1;

      const actualEnd = Math.min(end, file.length - 1);

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${actualEnd}/${file.length}`,
        "Content-Length": actualEnd - start + 1,
      });

      file.createReadStream({
        start,
        end: actualEnd,
      }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": file.length,
      });

      file.createReadStream().pipe(res);
    }
  } catch (err) {
    console.error(err);

    res.writeHead(500);

    res.end(`Bridge error: ${err.message}`);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Stremio PS5 bridge listening on port ${PORT}`);
});