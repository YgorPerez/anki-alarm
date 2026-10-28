# Remote preview

To show a page to someone away from the machine (on a phone, or friends), publish it at a temporary
https link:

```bash
scripts/remote-preview.sh prototypes/design      # serves a repo folder on port 8765
scripts/remote-preview.sh prototypes/design 8766 # another port
scripts/remote-preview.sh --port 40197           # a server already running on 127.0.0.1:40197
scripts/remote-preview.sh stop
```

It prints a `https://<four-words>.trycloudflare.com/...` link and returns. The server and tunnel
keep running in the background until `stop`, a reboot, or the next call, which takes the previous
ones down first. The last link is in `/tmp/anki-alarm-remote-preview/url`, with the logs next to it.

## How it works

- A folder is served by `python3 -m http.server`, bound to `127.0.0.1`.
- `--port` tunnels a server you already started, such as Impeccable's decision page
  (`impeccable serve-question --start`). Those servers refuse requests whose Host or Origin isn't
  local, so `scripts/host-proxy.py` sits in front and rewrites both.
- A [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
  (`cloudflared tunnel --url`) connects it to a random `trycloudflare.com` subdomain. No account,
  no open router port. If `cloudflared` isn't on PATH, the script downloads the official binary to
  `~/.local/bin/cloudflared`.

## Care

- **The link is public.** Anyone with it sees the folder, file listing included, and can answer an
  Impeccable decision page. Serve only folders with nothing private, and stop the tunnel when done.
- **The link changes on every call.** Send the new one each round; an old one answers Cloudflare
  error 1033.
- Quick Tunnels are for testing: no uptime guarantee and a cap on concurrent requests.

## When agents use it

When the harness's built-in preview can't open (in T3 Code, Ubuntu 23.10+'s AppArmor blocks its
browser) or the user is on a phone, run the script and put the link in the reply.
