# Lender data — what we have, for the Cursor build (2026-09-16)

Goal (Chris): split the lenders into **business** and **personal**, fill every column we
have data for, and load it into the CRM bank list.

## The files

| File | What it is | Rows | Has |
|---|---|---|---|
| `docs/legacy-strong/inquiry-master-database.csv` | **The giant file.** Which bureau each lender pulled, by state, from real credit inquiries. Alec's Legacy Strong Notion, scraped 2026-09-05. | 5,472 rows, 1,301 lender names, 99 state labels | `State, Creditor Name, Bureau` only. **No product, no apply link, no logo, no personal/business label.** Messy: bureau typos (`TrangUnion`, `Equilax`, `Exporian`, `Equitax`) and ~150 broken rows where commas split a name. Many names are store cards and car lenders, not banks you apply to. |
| `docs/legacy-strong/lenders-legacy-strong.csv` | **The CRM bank list.** The 45-column format the CRM loads. Earlier scrape, Aug 2026. | 313 (196 `InBranchBizCC`, 117 `OnlineBizCC`) | All business cards. **Zero personal.** In this copy: 122 apply links, 28 products, 3 bureaus. |
| `docs/legacy-strong/bank-datapoints-active-banks.md` | Alec's active-bank notes. | 26 issuers | Bureaus, HOT/FAIR/COLD, limits. |
| `docs/legacy-strong/state-funding-boards.md` | State boards and links. | 29 | Offers and links by state. |
| `docs/legacy-strong/bankers-rms.md` | Relationship managers. | 10 | Banker per bank. |

## The live CRM today

`lenders` table: **307** banks (6 of 313 held back by the import guards), **81** with a
bureau (46 stamped by the import, the rest by `db/migrations/365_lenders_bureaus_from_datapoints.sql`).

## Scripts that already exist — reuse them

| Script | Does |
|---|---|
| `scripts/lenders-import-alec.mjs` | Loads the 45-column CSV into `lenders` (guards before the write, says why a bank was held back). |
| `scripts/lenders-extract-bureaus.mjs` | Fills bureau + HOT/FAIR/COLD ranking from the sources above. Never overwrites, never guesses, leaves conflicts blank. Review: `docs/workflows/lender-list-2026-09-05.md`. |
| `scripts/lenders-extract-personal.mjs` | Pulls **personal** cards and loans out of Alec's notes pages into their own rows. This is the personal/business split. |
| `scripts/lenders-alias-map.json` | Name aliases for matching (Elan, FNBO and so on). |
| `scripts/notion-rescrape-datapoints.mjs` | Re-pulls Alec's Notion (needs a logged-in Notion). The full page copy used to live in `credentials/notion-scrape/output/` and is **not on this Mac**. |

## Missing

- A source that ties a **product** and an **apply link** to most banks: the bank list has links on only 122 of 313 and products on 28.
- **Logos** are not in any of these files; they come from `db/migrations/254_lenders_logo_path.sql` and the logo assets.
- Any **personal** lender rows: only `lenders-extract-personal.mjs` makes them, from the Notion pages that are not on this Mac.

## Build order for Cursor

1. Clean the giant file: fix the bureau typos, drop or repair the broken rows.
2. Match its lender names to the 313 banks (use `lenders-alias-map.json`). Fill `bureaus_pulled` where every state agrees; list disagreements, never guess (the rule in `lenders-extract-bureaus.mjs`).
3. Split: business rows stay in the 45-column CSV; personal rows get their own `lender_table` value via `lenders-extract-personal.mjs` (needs the Notion re-scrape first).
4. Load with `scripts/lenders-import-alec.mjs`, then `npm run ship`.
