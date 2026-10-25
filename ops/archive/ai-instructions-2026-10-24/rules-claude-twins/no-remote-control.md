# No Remote Control

**Owner law (2026-10-09):** Chris: "will not use rc." He does not want Remote Control (the phone driving the Mac's session).

## Why

He uses Claude cloud on his phone against GitHub. He wants cloud and local to work the same. The fix is parity, not a phone-to-Mac tunnel. On 2026-10-20 he started building his own phone-to-Mac bridge (`tools/mac-bridge/`, board `ops/workflows/mac-bridge-2026-10-20.md`).

## Always

- When he says "use it from my phone", give the cloud the same env keys and network access as the Mac.
- Keep GitHub `main` as the path to live (`github-ships-main`).

## Never

- Offer Remote Control as the answer.
