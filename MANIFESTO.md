# The NarChat Manifesto

## Knowledge belongs to humanity. Privacy is everyone's right.

Those two sentences are not decoration. They are the reason this repository is public, and they are in tension often enough that it is worth saying how we resolve it: what we *know* — how the system works, what it protects, where it fails — belongs to everyone, and so it is all here. What you *say* belongs to you alone, and so we built something that cannot read it, and then published the proof rather than the promise.

## Trust the code. Not us.

The most honest thing a privacy tool can offer you is a reason not to trust it.

We are not asking you to believe that we are good people who would never read your messages. Be suspicious of anyone who asks that — a promise you cannot check is not a promise, it is a wish. Instead we are handing you the code, the tests, and the limits. **We do not want your faith. We want your verification.**

There is a test in this repository that sends a real message between two real browsers, then opens the server's own storage from disk and searches it for that message in plaintext. If it finds it, the test fails. Run it yourself: `python3 test/e2e_roundtrip.py`. That is the whole argument, and it takes about thirty seconds.

## Where this came from

This did not begin as a product plan. It began with a small group of people who trusted each other and wanted one ordinary thing: that the things they said to each other were seen only by them. A simple wish — and a surprisingly rare one on today's internet.

So we built it at home. On an ordinary computer, with no data centre, no investors, and no monthly subscription. Apart from a domain name and the electricity bill, it cost approximately nothing. We do not say that as an apology. We say it as a claim: **communication privacy is a solved engineering problem.** What makes it rare is not the mathematics. It is that somebody has to sit down and do it in the open, where it can be checked.

There is a tradition for this — the one where curious amateurs worked out electricity in their own homes. Faraday's laboratory was modest; his work was not. We would like to belong to that tradition: **build it yourself, prove it, give it away.**

## What we believe, and what we built

**A server should be a courier that cannot open what it carries.** Your messages are encrypted on your device and decrypted only on the recipient's. The key to read them never reaches the server. This is not a setting we chose kindly; it is the architecture, and it is provable by the test above rather than by our word.

**We do not ask who you are, because we built nowhere to put the answer.** No phone number, no email address, no contact-list scraping, no location, no advertising identifier, no analytics. These are not switches we turned off. The fields do not exist in the code. We could not comply with a demand for them, because we never had them. All you give us is a username you invent and a password that never leaves your device.

**Openness is a security strategy for us, not a marketing gesture.** A small encrypted system that nobody can inspect does not become safe by being obscure — it becomes *suspicious* by being obscure. Being visible, and being visibly for everyone, is part of what protects a privacy tool and the people who use it. That was the least intuitive thing we learned, and the accompanying paper documents why.

## We will not lie to you

Honesty is the engine of trust, so the limits are stated as plainly as the features:

- **Content: nobody can read it, including us.** On this there is no compromise, and there is a test.
- **No forward secrecy.** If today's key is stolen, past messages can be opened. We are working on it, and until it exists we will not say it does.
- **The server sees who talks to whom, and when.** Not what — never what — but the pattern of contact is visible to whoever runs the server. We are not hiding this; reducing it is on the roadmap, not in the present tense.
- **Call signalling is not encrypted.** The audio and video streams are, but the setup traffic is not, and a hostile server could attempt to interfere with a call. Our messaging guarantees and our calling guarantees are not the same guarantee, and we will not let one borrow the other's reputation.
- **This is a pilot.** It carried real conversations between real people for weeks, on real devices. It is not a hardened service with an operations team.

Prefer a system that can count its own limits over one that claims perfection. We are not building a story that collapses at the first outage.

## Why there are two versions here

We would rather have given you only the first one.

The default branch is the system as it was designed: it keeps no connection records at all, because we never wrote the code to keep any. That version is complete, it works, and it is the one this repository opens on.

Then we asked a question that a lot of privacy projects avoid: what is actually required of someone who *operates* a service like this for other people? We read the law rather than assuming it. The finding surprised us. The obligations we read do not ask for your messages. They ask for connection records — that someone connected, when, and how much data moved. What they were asking for was never the encryption.

So we did not weaken the encryption. We instrumented the edges, on a separate branch, and measured the difference: **one production file changed, ninety-one lines added, two modified, and the cryptographic core unchanged to the byte.** You can check that in one command — `git diff paper-reference compliance-fork` — which is the point of publishing it this way.

Both are here because both are true. Different countries and different roles carry different obligations, and we cannot tell you which applies to you — we are engineers, this is not legal advice, and the paper reports what the law says without ruling on it. What we *can* tell you is this: **the version that collects nothing is not a thought experiment we are hiding. It is the default branch. Download it. Run it on any spare machine. Talk to exactly the people you choose, and to no one else.** Nothing in this repository asks anyone's permission for that.

## Take it

There is a guide in [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) that walks from an idle computer to a working private messenger for you and the people you pick. An old laptop is enough — ours was a 2012 desktop, and the paper says so by model number rather than hiding it.

You do not need us for any of it. There is no account to create with us, no key to request, no tier to buy, no permission to obtain. The licence is MIT: use it, change it, run it, ship it. If the project disappears tomorrow, your copy keeps working, because a copy is all it ever was.

## Build the rest with us

This is a one-person, zero-budget pilot, and the hard part that remains is not the cryptography. It is forward secrecy. It is shrinking the metadata. And it is the problem that no line of crypto has ever solved: **getting people to actually be in the same place.** Building working secure communication turned out to be the easy half; moving the conversations that already live somewhere else is the hard one.

If that is your kind of problem — the code is open and so is the door. We are looking for developers, researchers, and supporters who want to take this further than one person at a kitchen table can.

## Links

- **Source code:** https://github.com/NarchTech/narchat
- **The paper (EN + TR):** [doi:10.5281/zenodo.22017687](https://doi.org/10.5281/zenodo.22017687)
- **This software, archived:** [doi:10.5281/zenodo.22017587](https://doi.org/10.5281/zenodo.22017587)
- **Licence:** MIT
- **Run it yourself:** [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md), or three commands in the [README](README.md).
- **Contact:** open an issue at [the repository](https://github.com/NarchTech/narchat/issues); for security matters see [SECURITY.md](SECURITY.md).

---

*Trust the code, not us. Do not believe it — install it, read it, break it. That is the greatest respect a privacy tool can pay you.*
