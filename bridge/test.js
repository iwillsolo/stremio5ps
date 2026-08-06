import WebTorrent from "webtorrent";

const client = new WebTorrent();

client.on("error", console.error);

client.add(
  "magnet:?xt=urn:btih:f680e99d85f592dc79b76e22a59e4d239fce06e2&dn=test",
  torrent => {
    console.log("SUCCESS");
    console.log(torrent.infoHash);
  }
);