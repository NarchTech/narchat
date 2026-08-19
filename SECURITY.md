# Security

## Reporting a vulnerability

Please report security issues privately first, using GitHub's private vulnerability reporting on this repository: **[Security → Report a vulnerability](https://github.com/NarchTech/narchat/security/advisories/new)**. It opens a channel only you and the maintainers can see.

We will confirm receipt, tell you honestly what we think of the finding, and agree a disclosure timeline with you. There is no bounty programme — this is a zero-budget project and pretending otherwise would be the first dishonest thing on this page. What we can offer is that a real finding will be fixed, credited if you want credit, and written up rather than quietly patched.

If you would rather just open a public issue, do that. The project's own position is that openness is a security strategy, and we are not going to be precious about it. Use judgement: something that lets an attacker read stored messages deserves a private note first; a rate-limiting weakness does not.

## What is in scope

The server (`mesaj_server.py`, `auth_modul.py`), the client cryptography (`static/`), the authentication protocol, and the compliance variant's recording module. Attacks on a specific deployment's infrastructure are that operator's business, not this repository's.

## Known limitations — please do not report these as vulnerabilities

These are documented design limits, stated in the [README](README.md), the [manifesto](MANIFESTO.md), and §4 of the paper:

- **No forward secrecy.** Keys are static; a compromised key opens past messages.
- **The server sees metadata** — who talks to whom, when, and how much. It cannot see content.
- **Call signalling is not encrypted**, although the media streams are (DTLS-SRTP).
- **Avatars are not end-to-end encrypted** and should be treated as semi-public.
- **Password loss is unrecoverable by design.** There is no reset, because the server has nothing to reset with.

A demonstration that one of these is *worse than documented* is very much a finding. A report that one of them exists is a confirmation that we described the system accurately.

## What we would most like to be wrong about

The central claim is that the server cannot read messages, and the repository ships the test that checks it (`test/e2e_roundtrip.py` — it reads the server's own storage and fails if plaintext appears). If you can make that test pass while plaintext is nevertheless recoverable from the server, or find a path that puts readable content on the server's disk, that is the most valuable report this project can receive. Please send it.
