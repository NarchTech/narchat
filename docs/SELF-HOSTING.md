# Self-hosting NarChat

*From an idle computer to a private messenger for you and the people you choose.*

This guide assumes you can use a terminal and that you are not a systems administrator. Every command here is meant to be copied and run. Where something is a trade-off rather than a step, it is written as a trade-off, because the interesting decisions in self-hosting are not technical.

---

## 1. What you are about to take on

Running this yourself changes who is in the picture. Today, when you use somebody else's messenger, the list of people who know that you spoke to someone at 23:40 includes a company, its hosting provider, and whoever can compel either of them. When you run NarChat on your own machine, that list is: you.

That is the whole offer, and it is worth being precise about what it does and does not include. It does not make you anonymous. It does not make the system stronger cryptographically — the encryption is identical either way, and so are its limits (see §11). What it changes is *custody*: the ciphertext sits on a disk you own, the connection records — if any exist at all — are yours, and no third party is in a position to hand over what it never had.

You also take on the other half of custody: if you lose the machine, or the data directory, nobody can recover it for you. There is no support desk in this design. That is not an oversight; it is the same property that makes the system trustworthy, seen from the other side.

**Hardware:** anything that can run Python. The deployment described in the accompanying paper ran on a 2012-era desktop (Intel i5-3470, 16 GB RAM) and was never the bottleneck. A Raspberry Pi 4, an old laptop with a broken screen, a small VPS — all fine. The server is a single Python process with no database.

---

## 2. Five minutes to a running server

You need Python 3.10 or newer, and one dependency.

```bash
git clone https://github.com/NarchTech/narchat narchat
cd narchat

python3 -m venv .venv
.venv/bin/pip install cryptography

NARCHAT_PORT=8101 .venv/bin/python mesaj_server.py
```

Open `http://127.0.0.1:8101`. That is a working server. It generated its own session secret and Web Push key on first start, wrote them to `veri/` with mode `600`, and it is now waiting for someone to register.

You do not have to configure anything to get this far. Every setting in §4 has a working default.

---

## 3. Your first account, and closing the door behind you

Registration has two modes, and which one you are in depends on a single file:

| `veri/davetler.json` | Registration behaviour |
|---|---|
| **Does not exist** | Open: anyone who can reach the server can create an account. This is the state on a fresh install. |
| **Exists** | Invite-only: registration requires a valid code from that file. |

So the ordinary sequence is: start the server, register your own account while the door is open, then close it.

```bash
# 1. Register yourself in the browser first. Then, to require invites from now on:
cat > veri/davetler.json <<'EOF'
{"kodlar": ["NARC-A1B2-C3D4", "NARC-E5F6-G7H8"], "kullanilmis": {}, "otokodlar": {}}
EOF
```

Every code in `kodlar` is good for exactly one registration; used codes move into `kullanilmis`. Invent your own in the `NARC-XXXX-XXXX` shape and hand them out however you like — in person is a perfectly good distribution channel for a system meant for people who already know each other.

If instead you want a small public server, set `NARCHAT_KOD_ACIK=1` and the server will issue its own rate-limited codes on request (`NARCHAT_KOD_GUNLUK` per day globally, `NARCHAT_KOD_IP_GUNLUK` per address). Think about that decision before you make it: an open door is also how a server acquires users it did not choose, and you are the operator of whatever arrives.

**A note on passwords.** There is no password reset, because there is nothing to reset with — the password never reaches the server, and the keys live in the browser. A user who loses both their password and their device has lost that account, and you cannot help them. Tell your people this *before* they join, not after.

---

## 4. Configuration

Every setting is an environment variable, and all of them have defaults. The table below is complete as of this release; the authoritative source is always the code.

| Variable | Default | What it does |
|---|---|---|
| `NARCHAT_PORT` | `8101` | TCP port. |
| `NARCHAT_VERI` | `veri` (relative) | State directory. Set an absolute path in production so the data never depends on the working directory. |
| `NARCHAT_VAPID_SUB` | `mailto:admin@example.com` | Contact subject sent to Web Push services. Use an address you actually read. |
| `NARCHAT_KOD_ACIK` | `0` | `1` enables the self-service invite-code faucet (see §3). |
| `NARCHAT_KOD_GUNLUK` | `50` | Faucet: codes issued per day, all sources. |
| `NARCHAT_KOD_IP_GUNLUK` | `8` | Faucet: codes issued per day, per address. |
| `NARCHAT_RATE_LIMIT` | `30` | Authentication attempts allowed per address per window; `0` disables. |
| `NARCHAT_RATE_PENCERE` | `60` | Rate-limit window, seconds. |
| `NARCHAT_ARAMA_PUSH_ARALIK` | `5` | Seconds between "ringing" push notifications. |
| `NARCHAT_ARAMA_PUSH_SURE` | `45` | How long to keep ringing an unanswered call, seconds. |
| `NARCHAT_AKTARIM_TTL` | `600` | Lifetime of a one-time device-linking payload, seconds. |
| `NARCHAT_TURN_HOST` | *(unset)* | Your TURN server, for calls across strict NATs (§8). |
| `NARCHAT_TURN_PORT` | `3478` | TURN port. |
| `NARCHAT_TURN_USERNAME` | *(unset)* | TURN username. |
| `NARCHAT_TURN_CRED` | *(unset)* | **Secret.** TURN password. The only secret you ever pass in as configuration. |
| `NARCHAT_TEST_HOOKS` | *(unset)* | Test-suite hooks. Makes the server trust the `X-Forwarded-For` header for client addresses, and allows the variable below to take effect. **Never set this in production.** |
| `NARCHAT_CORS_TEST_ORIGIN` | *(unset)* | An extra origin allowed through CORS — only honoured when `NARCHAT_TEST_HOOKS` is also set. For the test suite; not for deployments. |

On the `compliant` branch only, two more exist — `NARCHAT_TRAFIK_KAYIT` and `NARCHAT_TRAFIK_SAKLAMA_GUN`. See §10.

---

## 5. The data directory

Everything the server knows lives in one directory. There is no database, and nothing is stored anywhere else.

| Path | Contents |
|---|---|
| `kullanicilar.json` | Accounts: username, public key, password verifier. No email, no phone number — those fields do not exist. |
| `odalar.json`, `kisiler.json` | Conversations and contact lists. |
| `mesajlar/`, `okundu/`, `tepkiler.json` | Messages and reactions, as ciphertext the server holds no key for. |
| `medya/` | Encrypted media blobs — likewise opaque. |
| `avatar/` | Profile pictures. **Not end-to-end encrypted** — treat them as semi-public. |
| `davetler.json` | Invite codes, if you created it (§3). |
| `duyurular.json` | Optional in-app announcement content, if you use it. |
| `.gizli`, `.vapid.pem` | Server secrets, generated on first run, mode `600`. |
| `push_aboneler.json` | Web Push subscriptions. |

**Backup is a copy of this directory, and nothing else.** With the server stopped, or with any snapshot tool that gives you a consistent copy:

```bash
sudo systemctl stop narchat
tar czf narchat-backup-$(date +%F).tar.gz -C /opt/narchat veri
sudo systemctl start narchat
```

Keep that archive somewhere encrypted — it contains `.vapid.pem` and every user's stored data. **Restoring is extracting it back.** Resetting the server completely is `rm -rf veri`, which destroys every account irreversibly, including yours.

---

## 6. Running it as a service

A unit file ships in `deploy/systemd/narchat.service`. Read it before installing: the configuration lives inside it, which is deliberate — a service definition and its configuration that live in one file cannot drift apart.

```bash
sudo useradd --system --home /opt/narchat narchat
sudo mkdir -p /opt/narchat && sudo cp -r . /opt/narchat/
sudo chown -R narchat:narchat /opt/narchat

sudo cp deploy/systemd/narchat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now narchat
sudo systemctl status narchat
```

Logs go to the journal:

```bash
sudo journalctl -fu narchat
```

*(The pilot ran under macOS launchd. Those files are not shipped here — they encoded one machine's layout, and systemd is the path worth documenting.)*

---

## 7. The reach ladder

By default the server listens on `127.0.0.1` only. This is fixed in the code rather than exposed as a setting, and that is on purpose: a server that has just been started cannot accidentally be on the open internet. Reaching it from another machine is therefore always a decision you make explicitly — and each rung of this ladder trades a little sovereignty for a little reach.

### Rung 1 — Private network only (the most sovereign)

Nobody outside your network is in the path, because there is no path. Two ways:

**Over a VPN (recommended).** Put the server and everyone's devices on a WireGuard network and keep the bind address as it is, listening only on the VPN interface. Your users reach `http://10.0.0.1:8101` from anywhere in the world, and to the rest of the internet your server does not exist.

**On the LAN.** For a server that should answer other machines on your own network directly, change one line — `mesaj_server.py`, near the bottom:

```python
# from:
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
# to:
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
```

Then confirm what you have actually exposed, because "0.0.0.0" means every interface, including the one facing your router:

```bash
sudo ss -lntp | grep 8101      # what is listening, and on what
sudo ufw status                # what your firewall allows in
```

Browsers restrict some features (notably microphone and camera access, and PWA installation) to secure origins. `http://` on a private address works for messaging; for calls you will want TLS, which means rung 2.

### Rung 2 — Your own domain and your own reverse proxy

You terminate TLS. You hold the certificate. The access logs are on your disk. This is the highest rung that is still fully yours, and if your connection allows inbound traffic it is the one to aim for.

Caddy, in its entirety:

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:8101
}
```

nginx, where one directive matters more than the rest — the live message stream is server-sent events, and a buffering proxy will silently stall it:

```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8101;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;          # required: SSE must not be buffered
        proxy_read_timeout 24h;       # long-lived stream connections
    }
}
```

### Rung 3 — A tunnel (Cloudflare Tunnel and similar)

If your connection is behind CGNAT — most home broadband and every mobile network — inbound connections are impossible and this rung may be the only one that works. The tunnel dials out; nothing dials in; you get a public HTTPS address without opening a port. An example config is in `deploy/cloudflared-example.yml`.

**Say the cost out loud:** a third party now terminates every connection your users make. It sees that someone connected, from roughly where, and when — exactly the connection metadata this system takes care not to collect itself. It does not see message content: that is encrypted end-to-end, and neither the tunnel nor your own server can read it. But "the operator cannot read your messages" and "nobody anywhere sees anything" are different claims, and only the first survives contact with this rung.

The pilot deployment ran this way, and the paper says so in those words rather than claiming a sovereignty it did not have. If that trade is wrong for you, rungs 1 and 2 exist.

---

## 8. Calls

Calls are peer-to-peer WebRTC. Audio and video are encrypted in transit (DTLS-SRTP) between the two devices.

**Without configuration, call setup contacts Google's public STUN server** (`stun.l.google.com:19302`, in `static/arama.js`). Google learns that a device at your address is setting up a call — not who with, and not the content, but a fact you may not want to leak. Running your own TURN server removes that dependency and also fixes calls that fail behind strict NATs. A minimal `coturn` configuration:

```ini
listening-port=3478
realm=turn.example.com
fingerprint
lt-cred-mech
user=narchat:choose-a-real-password
# TLS is worth adding once basic calls work:
# tls-listening-port=5349
# cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
# pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

Then point the server at it (in the unit file, not on the command line, so the credential does not land in your shell history):

```
NARCHAT_TURN_HOST=turn.example.com
NARCHAT_TURN_USERNAME=narchat
NARCHAT_TURN_CRED=choose-a-real-password
```

**One honest boundary, stated plainly:** the media is encrypted, but **call signalling is not**. A hostile or compromised server could attempt to interfere with call setup in ways it cannot attempt against messages. The messaging guarantee and the calling guarantee are not the same guarantee, and this documentation will not let one borrow the other's reputation.

---

## 9. Prove it yourself

You should not take any of the above on trust, including the central claim. The repository ships the check.

```bash
.venv/bin/pip install pynacl
.venv/bin/python test/e2e_roundtrip.py
```

That test performs the round trip with an *independent* cryptographic implementation (PyNaCl, a different binding than the browser client uses): it encrypts a message, pushes it through your running server, decrypts it as the recipient, confirms a non-member is refused — and then opens the server's own storage files and fails if the plaintext appears anywhere on disk.

It registers its own accounts as it goes, so run it against a server with a clean data directory — on a server that already holds those accounts it stops at a registration conflict rather than proving anything. Stop the server, `rm -rf veri`, start it again, and it will run. Do this on a test instance, obviously, and not on the one your friends are using.

The browser-level equivalent drives real browsers through a conversation and applies the same disk check:

```bash
npm install                      # Playwright, for the browser tests only
node test/browser_e2e.mjs
```

The rest of the suite is in `test/`. It is larger than the system it verifies, which was a deliberate choice and is documented in the paper.

---

## 10. Which branch should you run?

| Branch | What it does |
|---|---|
| `main` | The reference implementation. It keeps no connection records, because the code to keep them was never written. |
| `compliant` | The same system, with an added module that can record connection events — who connected, when, how many bytes moved — and never message content, which it still cannot read. Records are off unless `NARCHAT_TRAFIK_KAYIT=1`; with the flag unset the module is not even imported, and the branch behaves identically to `main`. |

The difference between them is one production file (+91/−2 lines), eight new files, and a cryptographic core that is unchanged to the byte. You can measure it yourself in one command:

```bash
git diff paper-reference compliance-fork --stat
```

**Which to run is not a question this document can answer for you.** Obligations differ by country, and they differ by what you are doing — running an instance for yourself and a dozen friends is not the same situation as offering a service to strangers. We report what the code does and what the law we studied says; we do not rule on either. **This is not legal advice.** For the reasoning behind the two versions, see [WHY-TWO-VERSIONS.md](WHY-TWO-VERSIONS.md) and the accompanying paper.

---

## 11. What self-hosting fixes, and what it does not

| It fixes | It does not fix |
|---|---|
| **Third-party transit** — on rungs 1 and 2, nobody else is in the path. | **No forward secrecy.** Keys are static: a stolen key opens past messages. This is the most significant limitation in the system. |
| **Custody** — the disks are yours, and so is every copy of the ciphertext. | **Metadata.** Your server sees who talks to whom and when. Self-hosting moves that visibility to you; it does not remove it. |
| **Compulsion** — nobody else can be compelled to produce data they were never given. | **Call signalling** is unencrypted (§8). |
| **Continuity** — your copy keeps working whatever happens to this project. | **Maturity.** This is pilot software that carried real conversations for weeks, not a hardened service with an operations team. |

Believe the right-hand column as much as the left. A system that can count its own limits is the only kind worth running.

---

## 12. Android

You can build and sign your own APK — see [`../BUILD-ANDROID.md`](../BUILD-ANDROID.md). Two things to change first, or your build will talk to the pilot's server instead of yours:

- `static/kok.js` — the API root constant used by the native build (currently the pilot host).
- `capacitor.config.json` — `appId` and the allowed-navigation host.

An APK you sign yourself cannot be updated by anyone else's key, which is the property you want. Keep the keystore somewhere you will still have it in two years; if it is lost, your users have to uninstall and reinstall to take an update.

---

*Questions this guide could not answer, or a step that did not work on your machine, belong in the issue tracker — a self-hosting guide that only works for its author is a failed document.*
