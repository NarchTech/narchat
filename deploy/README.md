# Deployment

NarChat is a single Python process that serves an HTTP API and a static PWA, and
keeps its state in flat files under `veri/`. There is no database to provision,
no build step for the client, and no external service it must reach in order to
work. Deploying it is therefore mostly a question of **who is allowed to reach
the port**, and that question is the whole of your privacy posture — so it is
answered honestly, and at length, in [`docs/SELF-HOSTING.md`](../docs/SELF-HOSTING.md).

This directory holds generic templates. Nothing here is specific to the pilot
deployment described in the paper; the operational configuration of that
deployment — tunnel identifiers, credential paths, host machine layout — is not
published, because publishing an operator's infrastructure is not the same thing
as publishing their software.

| File | What it is |
|---|---|
| `systemd/narchat.service` | A unit file for any systemd Linux. All configuration is environment variables inside the unit — which is also why this is the deployment style we recommend: the configuration and the service definition cannot drift apart. |
| `cloudflared-example.yml` | An example config if you choose a Cloudflare Tunnel for ingress. Read the trade-off in `docs/SELF-HOSTING.md` before you do: it is the easiest path to a public HTTPS address, and it routes your users' connection metadata through a third party. |
| `ikon-uret.mjs` | Generates the PWA icon set from `assets/logo.png`. Only needed if you rebrand. |

## The shortest possible path

```bash
pip install cryptography
NARCHAT_PORT=8101 python3 mesaj_server.py
```

That is a working server on `http://127.0.0.1:8101`, reachable from your own
machine. Everything else — a unit file, a domain, TLS, an ingress — exists to
widen that reach, and each widening is a decision about who else gets to see
that a connection happened. Make those decisions deliberately.
