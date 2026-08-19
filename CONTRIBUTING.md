# Contributing

The invitation in the [manifesto](MANIFESTO.md) is real, and this file is the short practical version of it.

## What would help most

The cryptography is the part that is finished. What is not finished, roughly in order of how much it matters:

1. **Forward secrecy.** Keys are static today, so a compromised key opens past messages. This is the system's most significant weakness and the change with the widest blast radius — it touches key management, device linking, and message storage at once. If you have done ratcheting work before, this is the conversation to start.
2. **Metadata minimisation.** The server sees who talks to whom and when. Reducing that — not claiming it away — is open design work.
3. **Internationalization.** The interface and the code comments are Turkish. Nothing about the architecture requires that.
4. **A second pair of eyes on the cryptography.** The system has been audited adversarially, including by people who did not build it, and the audit history is in the paper. More is better, and a finding that breaks a published claim is the most valuable thing anyone can send us.

Bug reports from people who actually ran it are worth a great deal too, especially from self-hosters — a deployment guide that only works for its author is a failed document.

## How

- **Issues** for bugs, questions, and design discussion. If you are proposing something large, an issue before a pull request will save you work.
- **Pull requests** should be small enough to review in one sitting, and should come with a test. This project's habit is to write the test first and watch it fail — a claim with a test that has never failed has not been demonstrated.
- **Run the suite** before you send: `test/` holds it. `python3 test/e2e_roundtrip.py` and `node test/browser_e2e.mjs` are the two that matter most, because they are the ones that check the central claim rather than a feature.
- **Do not weaken a stated guarantee to make something easier**, and do not add a claim the code cannot support. The value of this project is that its documentation and its behaviour match. Both directions of that are worth defending.

## Security issues

Please see [SECURITY.md](SECURITY.md).

## A note on how this was built

Most of this code was written by AI agents under one person's direction, and the paper documents that method rather than hiding it — including the classes of error it produced and the audits that caught them. You are welcome to work the same way or not; what the project asks of a contribution is that it be understood, tested, and honestly described by whoever sends it.
