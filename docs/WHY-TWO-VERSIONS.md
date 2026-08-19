# Why there are two versions

*A jurisdiction leaves a fingerprint on an architecture. This is the measurement of ours.*

If you have just cloned this repository, you have found two branches: `main`, the reference implementation, and `compliant`, a variant instrumented to keep connection records. For a project whose central claim is that its server cannot read anything, a second version that records *anything at all* deserves a real explanation rather than a footnote. This document is that explanation, and it is also the reasoning that the rest of the repository rests on.

**One disclaimer, stated once and meant: none of this is legal advice.** Obligations differ by country, and they differ by role — a developer, someone running an instance for their friends, and a company operating a public service are in three different situations. What follows reports what we found and what we built. It does not tell you what you may or may not do, and it does not rule on the law of any country, including our own.

---

## 1. What was built first

The reference implementation is the system as it was designed: a server that stores and forwards messages it holds no key to open. The encryption happens on the sender's device and the decryption on the recipient's; the server handles ciphertext and nothing else.

That is a claim, and claims are cheap, so the project answers it with a test rather than a promise. `test/e2e_roundtrip.py` encrypts a message with an independent cryptographic implementation, pushes it through a live server, decrypts it as the recipient, confirms a non-member is refused — and then opens the server's own storage files from disk and fails if the plaintext appears anywhere. Run it yourself; it takes about thirty seconds, and it is the shortest path to not having to trust us.

Be equally clear about what this does *not* buy. There is no forward secrecy: keys are static, and a stolen key opens past messages. The server necessarily sees routing metadata — it cannot deliver a message without knowing who it is for. Against an adversary doing traffic analysis, this system offers very little. What it offers, and can prove, is that the *substance* of a conversation does not exist on the server in readable form.

## 2. The question that followed

A system that cannot read its users is a piece of software. Running it for other people is something else, and it raises a question that a lot of privacy projects prefer not to ask out loud: **what is actually required of someone who operates a service like this?**

We decided to read rather than assume. The paper accompanying this repository documents that research in full, using Turkey as its case study — the authors' own jurisdiction, chosen because it is the one they are subject to, and because it happens to offer an unusually large body of case law about a small encrypted messenger.

The finding reorganized the project.

**The obligations we studied are about connection data, not content.** They ask who connected, when, for how long, and how much data moved. The statute defines that data as a closed list, and message content is not on it.

One honest blur survives, and the paper carries it rather than smoothing it over: an implementing regulation from 2007 describes a hosting provider's traffic data more broadly than the statute does, including a phrase — "transaction information (GET, POST command details)" — that could in theory reach content, since POST bodies carry data. Several things narrow it: the statute outranks the regulation, the regulation is visibly stale against it, and the Council of State has already struck out its open-ended catch-alls on the ground that the statute's own list is closed. But the phrase itself has never been litigated, and its practical reading is one of the paper's standing questions for counsel. We flag it here for the same reason the paper does: an uncertainty that is marked is a finding, and an uncertainty that is quietly rounded off is a mistake waiting to be someone else's.

Read that against the architecture and the shape of it becomes almost funny. The data the obligations ask for is precisely the metadata a content-blind design already produces in order to route anything at all. The data the design refuses to hold is precisely the data nobody was asking for. The collision everyone expects between "encrypted" and "compliant" did not occur where it was expected to occur — it did not occur at the cipher.

## 3. The fork, and the measurement

That finding made a fork possible that does not involve weakening anything. Instead of touching the cryptography, the variant instruments the edges: it records that connections and transfers happened, and it remains structurally unable to record what they contained.

The point of publishing both branches is that this becomes measurable rather than assertable. One command:

```bash
git diff paper-reference compliance-fork --stat
```

What it shows:

- **One production file changed** — `mesaj_server.py`, `+91 / −2` lines: six hook calls and three infrastructure blocks.
- **Eight new files** — the recording module, an operator tool, three compliance pages, two test files, and a runbook.
- **The end-to-end cryptographic core is unchanged to the byte** — `static/auth.js`, `static/app.js` and `auth_modul.py` show zero difference, and git will confirm it for you.
- **Nothing was deleted.** The two "removed" lines are one line expanded into two. The jurisdiction did not take anything out of this architecture; it only added at the edge.

That last property is the one worth dwelling on. Compliance here was not a redesign, a weakening, or a key-escrow scheme. It was a flag and a logging module, sitting beside a cryptographic core that never learned it was there.

## 4. What the variant records, and what it still cannot see

The recording module is `trafik_kayit.py`, and it is short enough to read in one sitting — which is the intended way to check the following.

**It records a closed list of events:** a registration, a session opening, a connection, and a message or media transfer. The hooks fire only after an operation has already succeeded, and they receive only metadata.

**Its schema is closed by construction.** A record holds a timestamp, the event type, the account name that is already visible to the server anyway, the connecting address, a port where one is observable, and a byte count. There is no content field — not one that is left empty, but one that does not exist. A developer who tried to pass message text to the logger would find the module rejects it, and a test in the suite exists to keep it that way permanently.

**Records expire and are destroyed.** Retention is configured in days and bounded at both ends; expired files are deleted on the daily cycle and again at start-up, so a server that spent a month switched off does not simply forget to catch up. The deletion pass is deliberately rate-limited — at most a few files per run — because a system clock that jumps forward is indistinguishable, to a naive cleaner, from a year passing, and the safe failure is to delete slowly and log the anomaly rather than to wipe an archive in one pass. A long-offline server therefore catches up over successive runs rather than instantly, and says so on standard error while it does.

**Administrative action leaves a trail.** The operator tool (`narchat_operator.py`) runs offline, refuses to act without a written justification, and writes every action to an audit log. It can suspend an account or delete a stored blob. It cannot read a message, because nothing in this system can.

The summary a reader should carry away: **the compliance variant records that a message moved and how many bytes it was. It has never recorded, and structurally cannot record, a single byte of what it said.**

## 5. What this measures

The general claim is modest and, we think, useful: **a jurisdiction leaves a fingerprint on an architecture, and that fingerprint can be measured instead of argued about.**

In our case it turned out to be small, entirely additive, and content-blind. That is one data point from one country and one small system, and it should not be over-read — a different jurisdiction, or a different reading of the same one, could leave a much heavier mark. But the falsifiable version of the claim is here in a form anyone can check, which is more than the debate usually offers.

## 6. So which one should you run?

Honestly: it depends on where you are and what you are doing, and the parts of that question that matter most are the parts we are not qualified to answer. Running an instance for yourself and a dozen people you know is a different situation from offering a service to strangers, in every jurisdiction we looked at.

But here is the part that matters most, and it should not be buried at the bottom of a document:

**The version that keeps no records is not a thought experiment, and it is not a historical artifact. It is the default branch.** It is complete, it works, it is what `git clone` gives you, and the licence is MIT. Download it, put it on a spare machine, and talk to exactly the people you choose. Nothing in this repository requires anyone's permission for that, and no part of the second branch takes it back.

The compliance variant is not a retraction and not a concession. It is a research result: it is what it looks like when an operator who wants to be accountable to the obligations of their country builds that accountability *without* asking their users to give up confidentiality. We published it because the measurement is the interesting part, and because the alternative — quietly shipping only one version and letting people assume the other is impossible — would have been the less honest thing to do.

---

*Further reading: [SELF-HOSTING.md](SELF-HOSTING.md) for running either branch yourself, [../MANIFESTO.md](../MANIFESTO.md) for why any of this exists, and the accompanying paper for the legal research in full, with citations and with its uncertainties marked as uncertainties.*
