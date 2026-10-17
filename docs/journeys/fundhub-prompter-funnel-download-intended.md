# Fundhub Prompter funnel download — intended

## Role

A Fundhub funnel customer who has reached `/thank-you`.

## One job

Open the approved Fundhub Prompter TestFlight download from the thank-you page.

## Flow

1. The customer reaches `https://apply.fundhub.ai/thank-you`.
2. The page reads Fundhub's public Prompter download setting.
3. Before Apple has approved a TestFlight invite, no Prompter card appears.
4. After the setting contains an approved `testflight.apple.com/join/...` URL, the page shows one Fundhub Prompter card below the confirmation hero.
5. Pressing **Download for iPhone** opens the official TestFlight invite in a new tab.

## States

- Loading: the existing thank-you page remains usable while the small setting loads.
- Empty: no card appears when there is no approved invite URL.
- Error: no card appears if the public setting cannot load.
- Full: one branded card opens the official TestFlight URL.
