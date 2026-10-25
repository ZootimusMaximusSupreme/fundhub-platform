# Owner-set 2026-08-15: what “harden it” means

Chris locked this. Do not treat try/catch, null-guards, or smash tests as hardening.

Harden means all five:

1. Find the actual thing that broke under load — not just the symptom you saw.
2. Add limits so it cannot overload itself the same way again (rate / concurrency caps).
3. Make retries safe — a retry must not double-call a person or double-send anything.
4. Add real logging so the next break is visible immediately, not after a pile of bad calls.
5. Test under similar volume before trusting it live again. One happy-path call is not enough.

Fake harden (forbidden): wrap a throw, add a comment, run one test, call it done.
