# Stremio for PS5 (unofficial)

A 10-foot webapp UI for [Stremio](https://stremio.com) built for a jailbroken PS5,
modeled on [ps5-payload-dev/svtplay](https://github.com/ps5-payload-dev/svtplay).

The PS5 webview has **no WebAssembly**, which is why `web.strem.com` itself
fails with "can't find variable: WebAssembly". This project therefore ships its
own dependency-free webapp that talks directly to the Stremio HTTP addon
protocol (Cinemeta catalogs, Torrentio streams) with plain `fetch()` + `<video>`.

## Install (PS5)
1. Jailbreak the console (e.g. [elfldr.elf](https://github.com/ps5-payload-dev/elfldr)).
2. Run `stremio-install.elf` (see Releases) on the PS5.
3. Launch the **Stremio** icon from the Media tab.
   The launcher survives reboot even without jailbreak.

## Build the payload
Requires [PS5_PAYLOAD_SDK](https://github.com/ps5-payload-dev/ps5-payload-sdk):
```sh
export PS5_PAYLOAD_SDK=/path/to/sdk
make
make test            # deploys to PS5 at $PS5_HOST (default "ps5", port 9021)