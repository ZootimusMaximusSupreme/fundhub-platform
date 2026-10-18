# Shared staff workspace foundation

Implemented in `public/app/fundhub-brand.css`, `crm-sidebar.css`, `sidebar.fragment.html`, `shell.js`, and new `workspace-ui.css`. No backend or marketing files changed by this workflow. No deployment or customer-data writes.

- Warm, light 224px rail; thin spectrum accent; consistent SVG icons; six task groups. Exact destination set, hidden rows, role lists, cached-session gate and client/entity carry rules stay intact.
- Rail mini state and group choices persist. Current destination stays visible. Mobile drawer has labelled controls, Escape, focus return, Tab containment and inert hidden navigation.
- Staff header occupies normal layout: 72px desktop, 68px phone. It owns page identity, visible all-client/current-client scope, Search, visible Chat and compact Account. Profile upload and sign-out retain existing handlers. Connection diagnostics live in Account > Technical details. Demo scope remains visibly marked Sample view.
- Scope reports the page URL rather than implying remembered navigation context filters the current page. Its disclosure explains the distinction and offers an explicit recent-client link/clear action. `FHWorkspaceScope.setClient({id,name})` is presentation only; Closer uses it when its existing booked-call resolver finishes. `fh:workspace-ready` is dispatched on document. Documents with its valid URL `client_id`/`id` filter is labelled selected-client; the unfiltered list stays All clients. This does not change the client-carry map.
- Removed the universal descendant font-size reset. Semantic defaults use ordinary CSS, so page hierarchy can work. Rounded system type applies to the proven canonical Fundhub org's legacy Inter seed only (`slug=fundhub`, `entity_name=Fundhub`, face Inter, non-partner session). Custom faces and partner fonts remain honored. Proof of identity: `db/schema/001_init.sql` Fundhub org seed and `db/migrations/128_org_brand.sql` effective-view slug binding.
- Search retains existing API/results/shortcut behavior, with explicit close, focus return and Tab containment added.

## Verification

`node --check public/app/shell.js`: pass.

101 targeted node tests: pass, zero skipped. Files: app-client-carry, search-screen, shell-is-fluid, status-tokens-are-semantic, app-nav-reachability.

Custom Chromium run with existing offline API fixtures: Pipeline, selected-client Closer and selected-client CCP at 1440, 390 and 320. All nine: zero page overflow, zero shared-header overflow, zero page errors; Search, Account and Chat open. Chat uses the existing launcher ID/handlers in the header, opens below it, and returns focus after Escape/Close. Mobile drawer closes with Escape and returns focus. Mini rail survives reload. Source reports were held in `/tmp/fh-foundation-browser.log` and `/tmp/fh-workspace-check.json` for root integration; full integration evidence is root-owned.

Typography guard checks: canonical Fundhub+Inter -> ui-rounded; canonical Fundhub+Rubik -> Rubik; other org+Inter -> Inter; partner payload named Fundhub+Inter -> Inter.

Existing sidebar browser suite: five role-gate tests pass. Two old IA expectations need root update for the authorized navigation change: old section labels and Sales Floor assumed to share the open Sales group. Existing partner-brand browser suite's final Fundhub Inter expectation needs the approved rounded default. These are recorded as pending test updates, not passing checks.

## Integration

Root must run `node scripts/sync-sidebar.mjs` after page edits are complete. It writes every page's canonical inline rail, so this workflow deliberately updated only the fragment and shell constant. No commits made by this workflow.

Legacy Fundhub API palette (`#FCFCFC` / `#0A0A0A`) is still honored as supplied; root was informed it can override the new warm default tokens. White-label/custom palettes were not changed.
