# UI-STANDARDS.md — FUNDHUB LAYOUT LAW

Read before building or changing any screen. This is the authoritative UI rulebook; editor rules point here. Brand assets and tenant selection stay in the existing brand, font and shell files. Apply the owner's recorded approval; flag an unresolved conflict without reopening a decision already made.

---

## 0. APPROVED ASTRA CONTRACT (owner-set 2026-10-20)

The owner approved the Astra direction for the whole CRM, customer portal and affiliate/partner surfaces. The approval and original rollout scope are recorded in [`ops/workflows/crm-astra-rollout-2026-10-20.md`](../../ops/workflows/crm-astra-rollout-2026-10-20.md). This section incorporates that decision; it does not approve another redesign.

- **Use the approved clean, professional workspace.** Short useful labels, quiet tabs, grouped summaries, data and work queues first, readable phone records and intact actions. The rejected iOS/glass treatment is not the design reference. Existing `client-ios-*` asset and class names still serve working navigation; do not remove them because of their names.
- **Reuse the established brand.** Keep `public/app/fundhub-brand.css`, `fundhub-font.css` / `fundhub-font.js`, `crm-sidebar.css` and `shell.js` as the shared sources. Fundhub retains its rounded type stack, including the bundled Nunito fallback and available native rounded face; explicit tenant fonts and wordmarks remain tenant-selected. Use `var(--sans)` and the existing tokens, not a new font, palette or framework.
- **Keep the official pastel ramp and F menu.** Fundhub's coral → peach → butter → sage → powder → lavender spectrum stays in the shared brand/sidebar. Keep the existing branded F menu beside the page title (for example, Calendar) on the phone; it opens the existing rail. Tenant branding continues through the shell's existing token/wordmark handling. Status colors remain semantic (§12.6).
- **Opt in; preserve the final cascade.** Add `fh-astra` to the existing body classes. Load `/app/fundhub-astra.css` after all legacy styles, then the relevant `/app/fundhub-astra-staff.css` or `/app/fundhub-astra-client.css`. Keep the existing cohort and page classes. Affiliate/partner presentation already lives in the shared sheet. Do not put later legacy styles after these includes or rewrite the shared shell per page.
- **Reuse the published classes.** `.fh-astra-page`, `.fh-astra-heading`, `.fh-astra-subtitle`, `.fh-astra-summary`, `.fh-astra-stat`, `.fh-astra-workspace`, `.fh-astra-tabs`, `.fh-astra-tab`, `.fh-astra-toolbar`, `.fh-astra-table-wrap`, `.fh-astra-table`, `.fh-astra-state`, `.fh-astra-action`, `.fh-astra-primary`, `.fh-astra-caption`. The three Astra sheets are the implementation reference; do not fork their presentation into a new system.
- **Preserve behavior and scope.** Keep useful controls, roles, entitlements, routes, data, IDs, state gates and the four states in §6. CSS must respect `[hidden]`, not reveal a denied action or hide a working one to improve a screenshot. This design approval does not authorize new capabilities, customer writes, money movement or recording changes.

The approved 16px body/input, 13px caption and 44px target floors below supersede the old 40px / 11px allowances. The current Astra type and shared header replace conflicting historical four-size whitelist, caps-mono heading, dark-topbar and page-reference instructions. Compatible role, width, layout, state, action and proof rules remain in force.

## 1. THE PAGE

- **One job per screen.** Every screen answers one question or enables one task. If you can't say the job in one sentence, it's two screens.
- **One primary action per screen.** Exactly one filled/prominent button. Everything else is secondary (outline) or tertiary (text link). Two primary buttons = a decision the designer refused to make.
- **Top-left is the most important thing.** Eyes land there first (F-pattern). The number or status the role cares about most goes top-left, largest. Never a logo, never a filter.
- **Content fills the window. No max width.** CRM content grows with the browser at any zoom level. Reserve only the existing shell navigation space: `--fh-side-w` / `--fh-side-w-mini` in `crm-sidebar.css` (currently 224px / 72px), released for the phone drawer. Tables keep their own scroll container. Cap a prose or entry-form block when it needs a reading measure, never the CRM page. Do not restore the old 1280px or 1800px page caps. Keep the `--fh-maxw` token for existing bounded reading blocks; it is not an app-wide cap. **Enforced by `src/ui/shell-is-fluid.test.mjs`** — retain the shell uncap, `width:100%`, zero inline margin and phone pin. Every tab must use the same fluid shell.
- **The fold matters.** The screen's job must be doable without scrolling on a 13" laptop (900px viewport height). Below the fold is for detail, never for the primary action.

## 2. LAYOUT GRID

- **Use the established spacing rhythm:** 8 / 16 / 24 / 32 / 48 / 64 for page layout. Related items 8-16 apart, groups 24-32 apart, sections 48-64 apart. Reuse the approved compact control and page-specific adjustments already in the Astra sheets; do not invent another spacing system.
- **Proximity is meaning (Gestalt).** Things close together read as related. If two cards aren't related, they need more space or a divider — not a border on everything.
- **12-column grid.** Cards span 3, 4, 6, or 12. Never 5, never 7. Uneven card widths in one row = slop signature #1.
- **Align to edges, not centers.** Left-align text and numbers in cards. Centered body text is for marketing pages only.

## 3. HIERARCHY & TYPE

- **Use a clear semantic hierarchy:** metric / heading / body / caption, using the existing Astra tokens and responsive page rules (§12.7). Do not restore the old forced-size whitelist or invent an unrelated type scale.
- **Numbers are the heroes on dashboards.** Keep the value more prominent than its muted label. Reuse the approved grouped summaries, including compact phone rows with the value beside its label; do not enlarge them until the next task falls out of view.
- **Readable type floor:** main body and inputs 16px; captions at least 13px. A caption style is not a way to shrink body copy or form text.
- **Tabular numerals for all metrics and tables** so columns of numbers align.
- **No ALL-CAPS body text.** Caps for small labels/eyebrows only, with letter-spacing.

## 4. NAVIGATION

- **Max 7 top-level nav items per role (Miller).** More than 7 = group or cut.
- **Role-scoped nav.** A user never sees a nav item they cannot use. No disabled nav, no 403-on-click. If the role can't act on the screen, the item does not render. (This is finding-class UI-12 from the Aug 16 audit — 12 rows of it.)
- **Current location always visible.** Active nav state + page title match. User answers "where am I" in zero seconds.
- **Two levels deep, max.** If it needs a third level, the IA is wrong.

## 5. ACTIONS & CONTROLS

- **Big targets (Fitts):** every visible interactive hit area at least 44px in each dimension; primary actions preferably 48px high. Measure the actual native control, including selects, links, summaries, switches and open menus. The old 40px target floor is superseded. Destructive actions remain physically separated from safe ones.
- **Every visible control works.** No buttons wired to nothing, no controls the role lacks permission for, no "coming soon" UI in production. If it doesn't do anything today, it does not render today.
- **Buttons say what happens:** "Send letters," "Add closer," "Run soft pull" — never "Submit," "OK," "Go."
- **Destructive = confirm with consequence named.** "Delete 14 contacts? This can't be undone." Never a bare "Are you sure?"
- **Every action answers back.** Click → immediate state change: spinner in the button (not page takeover), then success/failure where the user is looking. Silent success is a bug.
- **Fixed-document exception only:** PDF annotation boxes in `.fh-astra-document .pagewrap .fld` retain their saved percentage coordinates and scaled document geometry. Their inputs may reset minimum dimensions, padding and line-height to fit the exact box, as implemented in `fundhub-astra-client.css`. Keep 16px annotation input text, containment, focus and keyboard behavior. Ordinary name/agreement/sign controls and other forms retain the normal type/target floors; never apply this exception to a whole form.

## 6. STATES (every screen ships all four or it isn't done)

1. **Loading** — skeletons in the real layout. Never a blank screen, never a full-page spinner.
2. **Empty** — says what will appear here + one action to make it appear. "No clients yet. Add your first client." NEVER fake sample data presented as real. (Audit finding: sample furniture with a false excuse = trust destroyed.)
3. **Error** — says what failed, in the user's words, and what to do next. Never a raw status code, never a lie ("not signed in" when they are signed in).
4. **Full** — the happy path, designed against realistic volume: 27 clients, not 3. Long names truncate with tooltips, tables paginate at 25.

## 7. DATA DISPLAY

- **Data-ink (Tufte):** no gridlines heavier than the data, no borders around everything, no gradients or 3D on charts, no decorative icons beside every metric. If deleting a pixel loses no information, delete it.
- **Right chart for the job:** trend = line, comparison = bar, composition = stacked bar (pie only with ≤3 slices), single status = big number. Default is the big number, not a chart.
- **Every metric has a comparison.** A number alone means nothing: vs yesterday, vs target, vs last week — small, muted, beside or under the value.
- **Tables:** left-align text, right-align numbers, one-line rows, sort on the column the role cares about by default. Row click opens detail; actions live in the row's far right.
- **Timestamps:** relative under 24h ("2h ago"), absolute after ("Aug 14, 3:02 PM"). Always tooltip the exact time.

## 8. FAMILIARITY (Jakob's Law)

- Settings gear top-right. Profile top-right corner. Search top. Notifications bell. Filters above the table, left. Save bottom-right of forms.
- Don't invent novel patterns for solved problems. Novelty budget is zero on internal tools.

## 9. PROGRESSIVE DISCLOSURE

- **Default view = the 20% used daily.** Everything else one click deeper (tabs, "View details," drawers).
- Advanced filters collapsed by default. Bulk actions appear on selection, not before.
- A new employee should understand any screen's default state in 10 seconds without training.

## 10. ROLE LENS (Fundhub-specific)

Every dashboard is built for its role's first question of the day:

- **Closer:** "Who am I calling next?" — today's calls, top-left. Not company metrics.
- **Funding advisor:** "Which files need me?" — action queue first.
- **Sales manager:** "Is the floor on pace?" — held/booked/closed today vs target.
- **Owner:** "Is the machine healthy?" — cash, CAC, close rate, pipeline. The ONLY role that sees company-wide metrics by default.
- **Client:** "Where is my money/file?" — status of their thing, next step, one contact action.
- **Affiliate/partner:** their referrals, earnings and next useful partner action — preserve the existing referral, payout and training gates.

If a screen serves the wrong question first, it fails this doc regardless of how clean it looks.

## 11. PHONE, LANDSCAPE AND WIDER WINDOWS

The CRM must be useful and readable on the owner's iPhone 17 Pro Max and in wider web windows. Check **390px**, the locally available Pro Max profile (440px in the rollout), phone landscape, intermediate widths (including 768px / 1024px) and desktop/Mac-web sizes. These are viewport/engine checks; they do not certify a physical iPhone, native app or unreleased foldable device.

- **One readable phone column.** KPI rows, two-pane screens, Present, and card grids stack vertically. Compact label/value rows may stay inside a card; never squeeze whole cards to one letter per line. Keep the existing specialist canvas/document behavior.
- **No sideways page scroll or clipped card contents.** A table that must stay a table may scroll inside its own box; approved record layouts retain their labels, values and actions. Check internal overflow as well as document width.
- **Keep the reading and target floors.** Main body and inputs 16px, captions at least 13px, hit areas at least 44px, primary actions preferably 48px. The old 11px text allowance is superseded; §5's fixed-document exception is narrow.
- **Open the real controls.** Check expanded menus, account/context disclosures, native selects, chat, drawers, forms and editors. Keep every action reachable, with clear vertical scrolling in short landscape windows. Do not shrink text or targets to meet a fold test.
- **The name chip lives in the header**, not over the page.
- **The branded F menu opens the rail.** Keep it beside the page title, including Calendar. The rail does not sit on the phone page as a strip of icons.

## 12. THE SCREEN FRAME (updated to the approved 2026-10-20 contract)

**The shared Astra contract in §0 is the current reference.** The approved Team & Access treatment in `staff-teams.html` / `fundhub-astra-staff.css` shows the staff workspace; the shared and client sheets carry it into other cohorts. `pipeline.html` remains a specialist board example, not permission to override this rulebook or copy its legacy styles into every screen.

Why this section exists: on 2026-08-19 two screens were reworked on the same day with opposite instructions, and both agents cited this document. Neither was wrong, because nothing here said what a container looks like at rest. The frame was folklore. It is written down now. **Enforced by `src/ui/screen-standard.test.mjs`.**

### 12.1 The resting container

A panel at rest is exactly four declarations:

```css
background:#fff;
border:1px solid var(--line);
border-radius:10px;
box-shadow:var(--panel-shadow);
```

That is the shared panel treatment. Reuse the approved 10px card/workspace radius and 8px control radius from the Astra sheets. Grouped summary cells and tabs deliberately remove their individual elevation (§12.5); do not turn them back into a row of separate raised cards.

### 12.2 The shadow is never written on a screen

`fundhub-brand.css` already applies `--panel-shadow` app-wide to these names:

`.card` · `.stat` · `.panel` · `.tabs` · `.editor` · `.fos-panel` · `.kpi-tile` · `.big-tile` · `.calc-panel` · `.compose` · `.ctx-card`

**A new container takes one of those class names, or gets added to that list. It never hand-rolls a shadow value.** Two screens carrying two slightly different shadows is the drift this whole section exists to stop, and it is invisible in review — nobody compares `0 2px 8px rgba(10,10,10,.06)` against `0 2px 6px rgba(0,0,0,.08)` across two files. The token is the only way they stay equal.

The list is deliberately conservative and was measured, not guessed. Buttons, inputs, avatars, chat bubbles and table rows are white too and are excluded on purpose — a resting shadow on those reads as broken, not expensive.

### 12.3 Shadow beyond the token means something is happening

Historical Pipeline examples show stronger shadows as interaction states, not decoration:

| Where | Line | What it means |
|---|---|---|
| `.card:hover` | 242 | you are pointing at this |
| `.col.drop-target` | 225 | let go here |
| `.drag-card` | 308-309 | this is in your hand |
| `.route-menu` | 315-316 | this floats above the page |

**Resting elevation is the token. Anything stronger is an event.** A stack of resting panels each with its own drop shadow reads as four things happening at once and none of them are.

### 12.4 `border:0` on a shadow-list class is forbidden

Removing the border from a class on the 12.2 list does not simplify it — it paints **a floating shadow with no edge**, a soft grey smudge around nothing. The border is what the shadow is a shadow *of*.

Historical examples from the August audit were `.calc-panel` and `.big-tile` in `closer-dashboard.html`: each removed its border while inheriting a shadow. This explains the invariant, not a current failure receipt.

The one legal way to take the border off is to take the shadow off in the same rule — `border:0;box-shadow:none` turns a panel into a plain block, which is a real and useful thing to do. Half of it is not.

### 12.5 Group containers take a tint, not a shadow

A box that holds other boxes is not itself a panel. It gets a flat tint and a hairline:

```css
.col{background:var(--paper-dim);border:1px solid var(--line);border-radius:8px}
```

That is the historical Pipeline grouping example; the current Astra column uses its shared 10px radius. The cards inside carry the shadow; the column does not. Nesting a shadow inside a shadow is §7's "no borders around everything" wearing a different coat.

The approved Astra summaries use one outer group, internal dividers and quiet tenant-token tints; the cells have `border:0;box-shadow:none` apart from their divider. Tabs use an underline and no resting shadow. Preserve these existing grouped treatments.

### 12.6 Status is never colour alone

`paintBrand()` in `public/app/shell.js` preserves `--alert`, `--warn`, `--ok` and `--info` at their semantic brand-file values. Tenant customization applies to ink, paper, spectrum, accent, type and wordmark, not those four status tokens. **Enforced by `src/ui/status-tokens-are-semantic.test.mjs`.** The older claim that tenant ramps should repaint every status is superseded.

Every status still carries a second signal — a word, a shape, or a position. The following August 2026 examples explain this invariant and past failures; they are not current screen certification:

- pipeline.html:216-225 — the headline counters say **"on a bank" / "on the client" / "nothing recorded"** in words, and the chosen one is a solid ink **fill**, not a tint. A word survives any ramp; a fill still reads as chosen when every hue in the ramp is the same.
- pipeline.html:343-353 — `.c-needs-amount` is deliberately **literal amber** (`#FEF3C7` / `#92400E` / `#FCD34D`), not a brand variable, with the reason written above the rule, *and* it says "Amount needed" in words. That is the escape valve when a warning must stay amber on every tenant. Use it sparingly and write the reason down, exactly as that rule does.

Never ship a legend whose only key is colour, and never write "the red ones need attention" in copy.

**Two examples this section used to give have never once painted (corrected 2026-08-30).** They were `.card.held` (a left stripe plus a tint) and `.hold-badge` (the word HELD in a pill), and both are real CSS sitting in pipeline.html to this day — `.card.held` at :323-324, `.hold-badge` at :358-363. Nothing ever puts either class on an element. `cardEl()` does not add `held`, so the "Held only" filter matches nothing and the `— held` figure has been a dash since the day it shipped. The hold data exists (`clients.custom_fields.round_hold_reason`, written by seven workflows) and the board has never read it.

They are named here rather than deleted because the shape of the stripe is still the right answer and somebody will want it back. **But do not cite dead CSS as the model.** An example that has never run cannot show you that it works, and the next person copies it believing it has been proven. Before this section points at a rule, open the screen and check the class is actually applied to something.

**The class being applied is still not proof that anything paints.** The same commit that corrected the two examples above shipped a third dead rule eleven lines from `.card.held`, and its class *was* applied:

```css
.card.fh-spot{box-shadow:0 0 0 3px var(--spectrum);}   /* painted nothing */
```

`--spectrum` is a `linear-gradient` — `fundhub-brand.css` defines it, and `rampToSpectrum()` in `shell.js` rebuilds it from the six-stop brand ramp for every white-label tenant. **The colour component of `box-shadow` must be a `<color>`.** A gradient there makes the whole declaration invalid at computed-value time, so `box-shadow` fell back to its initial value, `none`. `background:var(--spectrum)` on the same screen (`.drop-line`) is correct, because a background *does* take a gradient — so the token looks proven right next to the rule it breaks.

Worse than a missing nicety: `.card.fh-spot` is (0,2,0), which outranks the resting `:is(.app,.app-shell) :is(.card,…)` shadow at 12.2. Killing it took the card's own elevation with it, so the card the user had just been jumped to was **the only flat card on the board** — the feedback was inverted, not absent. Measured 2026-08-30: spotted card `none`, every neighbour `rgba(10,10,10,.04) 0 1px 2px, rgba(10,10,10,.06) 0 2px 8px`.

Two rules follow, and they are cheap:

- **A shadow, outline, border-colour or text-shadow takes a colour token. Never `--spectrum`.** Use `--ink` for a ring you need on every tenant — a ramp stop such as `--accent` is `ramp[5]`, which a one-hue tenant can wash out to the board behind it. Add the resting token back where you are overriding it: `box-shadow:var(--panel-shadow),0 0 0 3px var(--ink)`.
- **Assert the computed style, never the class.** `toHaveClass(/fh-spot/)` passed green the entire time the rule was inert, which is why nobody caught it. `e2e/pipeline-waiting-on.spec.mjs` now reads `getComputedStyle().boxShadow` and compares it to an untouched card beside it, because "looks exactly like its neighbours" is the failure being tested for.

### 12.7 Semantic type and the actual cascade

The old universal `font-size:inherit !important` rule is gone. `fundhub-brand.css` now supplies semantic defaults with low-specificity heading/caption rules; it does not flatten every descendant. `src/ui/screen-standard.test.mjs` explicitly rejects that old flattening rule. Do not restore it or the historical one-escape-hatch whitelist.

| Astra token | Default size | Use |
|---|---|---|
| `--fs-metric` | 32px | Metrics and prominent desktop headings |
| `--fs-title` | 22px | Section titles and compact headings |
| `--fs-body` | 16px | Main body and form inputs |
| `--fs-caption` | 13px | Supporting labels and captions |

These are the existing `body.fh-astra` defaults, not the legacy brand body's 15px baseline. Reuse the existing cohort/page responsive headings rather than forcing every heading to one size. The approved Astra labels use the shared sans face and normal case; section headings do not have to become 13px caps-mono.

Legacy inline styles, page-specific `!important` maps and dynamically inserted widget CSS can still win. Use the existing scoped cohort overrides, with a reason for necessary specificity; verify the computed text size after the control opens or the widget loads. A class name or stylesheet declaration alone is not proof.

### 12.8 The topbar contract

Reuse `mountWorkspaceHeader()` in `shell.js` and its styles in `crm-sidebar.css` / `fundhub-astra.css`. It owns staff identity, the page title and actual context, Search, account/tools and the phone F menu. Keep page-specific actions in the existing toolbar. External client/partner principals retain their established role-appropriate chrome; public signing/entry pages must not acquire the authenticated staff shell merely for styling.

- **Keep truthful context.** A remembered client link is navigation memory, not proof that the page is filtered to that client. Keep the shell's existing scope labels and role gates.
- **Allow wrapping and scrolling.** Use the shared header's automatic height, shrinking text containers and wrapping tools. Expanded account/context panels must stay within the viewport and scroll in short windows; check the open state.
- **Keep controls at their full hit size.** Let text wrap or truncate appropriately. Do not clip a wrapped row or hide an action to fit the old fixed-height topbar.
- **Keep overlays reachable.** Drawers and report panels must account for the actual shared header height; Close, Save and other actions cannot sit underneath it.

The old dark bar with a mandatory wordmark/separator/org/LIVE/clock cluster is historical, not the Astra reference. The underlying invariant remains: `flex-wrap:wrap` must not combine with a fixed height or `overflow:hidden` that discards the second row. `src/ui/screen-standard.test.mjs` continues to enforce it.

## 13. PROOF AND RELEASE

Keep the existing source guards and behavior tests. In particular, preserve `src/ui/shell-is-fluid.test.mjs`, `screen-standard.test.mjs`, `status-tokens-are-semantic.test.mjs`, `rounded-reference-font.test.mjs` and the rollout `check-contracts.mjs` script/ID/cascade checks. Fix an actual defect; do not relax assertions to make a design pass.

For changed UI, run the relevant source/browser checks, lint and TypeScript, then inspect the four states and actual visible/open controls across §11's sizes. Keep PDF annotation geometry covered by `e2e/astra-pdf-field-geometry.spec.mjs` alongside normal form controls. Use fictional fixtures for controlled proof; preserve real customer, permission, auth and money boundaries. Mark review screenshots with a red box and caption.

Historical source-only guards may still assert legacy values beneath the final Astra cascade, including Present's 11px source check. Keep those tests unchanged; they do not waive the approved rendered 16px body / 13px caption floors. Measure the final computed result as well.

Record local checks, GitHub checks, deployment, actual live assets, authenticated paths and physical/native-device checks as distinct evidence. A saved design, passing viewport or merge does not prove a live customer journey or real iPhone/Mac app readiness. Existing heartbeat/tripwire, performance, page go-live and teleprompter rules still apply; this UI sync grants no new release or side-effect authority.

---

*Slop signatures (instant fail): uneven card rows · five borders where spacing would do · buttons that 403 · sample data as real · full-page spinner · centered paragraphs · "Submit" · unrelated type scales · metrics with no comparison · nav items a role can't use.*
