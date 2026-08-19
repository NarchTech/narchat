# NarChat

**An end-to-end encrypted messenger built to be understood, not just trusted.**

One handwritten Python file for a server deliberately too dumb to read your messages, a browser client that does all the cryptography, and a test that proves the claim by reading the server's own disk and failing if it finds plaintext.

Built on consumer hardware, at an infrastructure cost of approximately zero, by one person directing AI implementation. It is a **pilot**, not a product — and this repository, together with [the paper](#the-paper), is the whole of it, laid open on purpose.

> **Why open?** Because for a small encrypted system, being seen — by everyone, to be for everyone — is itself a security property. The paper explains why; it is the least intuitive thing we learned. **Trust the code, not us.**

---

## What it is, honestly

- **The server is a courier of opaque blobs.** It stores and forwards ciphertext it has no key to open. This is not a promise: `test/e2e_roundtrip.py` drives a real message through a running server, then opens the server's storage files from disk and **fails if a sentinel plaintext appears anywhere**.
- **End-to-end encrypted** text and media (libsodium; X25519 + XSalsa20-Poly1305 fan-out), one-to-one and small groups.
- **No personal data at signup.** A username and a password, nothing else. No phone number, no email address. The password never leaves your device — login is a challenge–signature exchange.
- **Voice and video calls** (WebRTC, DTLS-SRTP), a progressive web app, and a signed Android APK.
- **No database, no framework, no CDN-served assets, no analytics.** The Python standard library plus one dependency.

## What it does NOT provide — read this too

Honesty is the point, so the limits are stated as plainly as the features. Full detail is in §4 of the paper.

- **No forward secrecy.** Keys are static; a compromised key opens past messages. This is the system's most significant weakness.
- **No metadata privacy.** The server sees who talks to whom, when, and how much — it simply cannot see *what*.
- **Call signalling is not encrypted.** A malicious server could attempt to interfere with call setup. The messaging guarantee and the calling guarantee are not the same guarantee; please do not let one borrow the other's reputation.
- **Pilot scale.** It worked, with real people on real devices, for weeks. It is not a hardened service.

If those trade-offs disqualify it for your threat model, believe the limits, not the pitch.

---

## Run it in five minutes

Python 3.10+ and one dependency (`cryptography`, for Web Push and signature verification).

```bash
# 1. get the server up — the standard library does the rest
python3 -m venv .venv && .venv/bin/pip install cryptography
NARCHAT_PORT=8101 .venv/bin/python mesaj_server.py        # → http://127.0.0.1:8101

# 2. open it in two browser profiles, register two users, talk to yourself.

# 3. prove the server can't read you — the negative test:
.venv/bin/pip install pynacl
.venv/bin/python test/e2e_roundtrip.py
```

That third command is the whole thesis in one run: an **independent** implementation (PyNaCl, a different binding than the client's) round-trips ciphertext through the live server, a non-member is refused, and the server's storage is checked for plaintext leakage. The browser-level version is `node test/browser_e2e.mjs`.

*(The test registers its own accounts, so it wants a server with a clean `veri/` — against a server that already holds those accounts it stops at a registration conflict. Stop the server, `rm -rf veri`, start it again, and it runs.)*

State lives in flat files under `veri/` (git-ignored — it holds session secrets and user data). Delete that directory to start clean.

**Running it for real** — on a spare machine, for your own circle of people — is [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md): first account and invite codes, systemd, the three ways to make it reachable and what each one costs you in metadata, your own TURN server, backups, and an honest list of what self-hosting fixes and what it does not.

---

## The two branches

| Branch / tag | What it is |
|---|---|
| `main` | The current pilot: the reference system plus the fixes and additions that came from actually running it. **Keeps no connection records** — the code to keep them was never written. |
| `paper-reference` (tag) | The exact state the accompanying paper froze its evidence base against, 7 July 2026. |
| `compliant` | The same system, instrumented to keep the connection records that operator obligations in some jurisdictions ask for — who connected, when, how many bytes — and **still unable to read a message**. Off unless `NARCHAT_TRAFIK_KAYIT=1`; with the flag unset it behaves identically to the reference. |
| `compliance-fork` (tag) | That variant at the moment it forked, before this release documentation was added to either branch. It exists so the measurement below stays about the code and nothing else. |

The difference between them is one production file (`+91 / −2` lines), eight new files, and a cryptographic core that is unchanged to the byte. You do not have to take that on faith either:

```bash
git diff paper-reference compliance-fork --stat
```

**Why two versions exist at all** — the legal research that produced the fork, what the variant records, and why the default is still the one that records nothing — is [`docs/WHY-TWO-VERSIONS.md`](docs/WHY-TWO-VERSIONS.md). Short version: the obligations we studied ask for connection data rather than content, and recording what they ask for did not require weakening the encryption. That document reports what we read, including the one place where the wording is genuinely unsettled. None of it is legal advice.

## Repository map

| Path | What |
|---|---|
| `mesaj_server.py` | The whole server — a dumb relay and a ciphertext depot. |
| `auth_modul.py` | Zero-knowledge authentication (Ed25519 challenge–signature). |
| `static/` | The PWA client: interface, end-to-end cryptography, service worker, calls. |
| `test/` | The suite that is larger than the system it verifies — including the disk-reading sentinel test. |
| `deploy/` | Generic service and ingress templates. |
| `docs/` | Self-hosting guide and the reasoning behind the two versions. |
| `android/` | Capacitor wrapper for the signed APK; build instructions are in `BUILD-ANDROID.md` at the repository root. |

## The paper

The design, the cryptography, the honest limits, the development method (human-directed, AI-implemented, independently audited), and the legal research that produced the compliance fork are documented in an accompanying paper:

> *Content-Blind by Construction: Building, Auditing, and Legally Situating a Zero-Budget End-to-End Encrypted Messenger* — Melikoğlu, Altınbaş & Tanrıöver, 2026. English and Turkish: [doi:10.5281/zenodo.22017687](https://doi.org/10.5281/zenodo.22017687)
>
> This repository is archived, with its full history, at [doi:10.5281/zenodo.22017587](https://doi.org/10.5281/zenodo.22017587) — cite that if you cite the software.

Every technical claim in the paper binds to an artifact in this repository — a file and a line, a named test, an audit-log entry — never to a running service. Services die; code does not.

---

## A few notes on what you are reading

**The development history is not published.** This repository begins at the paper freeze. The project's original commit history — 76 commits — carries pilot users' details and the operating machine's layout in its metadata, so it stays in a private archive, exactly as the paper's Availability section says it does. What is published is the source, complete, at three points in its life.

**Operational configuration has been replaced with templates.** The tunnel identifiers, credential paths and host layout of the pilot deployment are not here. Publishing an operator's infrastructure is not the same act as publishing their software.

**The screenshots are staged**, generated against an isolated server with invented accounts and invented conversations. No real user, username or message appears anywhere in this repository.

**The code is commented in Turkish**, and so is the interface. The pilot was a Turkish-speaking group and the strings were never internationalized — a real limitation, recorded rather than hidden. The documentation is in English; a Turkish translation of these documents lives alongside them.

## Building this together

This is a single-developer, zero-budget pilot, and the hard part left is not the cryptography — it is everything around it: forward secrecy, metadata minimisation, and the distribution problem that no line of crypto solves. If that is your kind of problem, the code is here and the invitation is open. See [`MANIFESTO.md`](MANIFESTO.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

**MIT.** Use it, change it, run it, ship it. See [`LICENSE`](LICENSE).

---

### Türkçe

Bu belgelerin Türkçesi: [`README.tr.md`](README.tr.md) · [`MANIFESTO.tr.md`](MANIFESTO.tr.md) · [`docs/SELF-HOSTING.tr.md`](docs/SELF-HOSTING.tr.md) · [`docs/WHY-TWO-VERSIONS.tr.md`](docs/WHY-TWO-VERSIONS.tr.md)
