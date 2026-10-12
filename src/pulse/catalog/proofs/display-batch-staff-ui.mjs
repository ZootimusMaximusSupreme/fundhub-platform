import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const TEST_FILE = "src/pulse/catalog/proofs/display-batch-staff-ui.test.mjs";

const MAPS = new Map();

function rowsFor(sourceFile) {
  if (!MAPS.has(sourceFile)) {
    MAPS.set(sourceFile, JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8")));
  }
  return MAPS.get(sourceFile);
}

function group(sourceFile, surface, specs, controls) {
  return Object.freeze({
    sourceFile,
    surface,
    specs: Object.freeze([...specs]),
    controls: Object.freeze([...controls]),
  });
}

export const STAFF_UI_GROUPS = Object.freeze([
  group("desks-a.json", "agent-editor.html", [
    "e2e/agent-editor.spec.mjs",
    "e2e/agent-editor-promote-demote.spec.mjs",
  ], [
    "Save agent button",
    "Promote to live button (saves first, then promotes, confirm dialog)",
    "Return to shadow button (demote, confirm dialog)",
    "Prompt textarea",
  ]),
  group("desks-a.json", "client-control-panel.html", [
    "e2e/ccp-headline.spec.mjs",
  ], [
    "Mark round submitted button",
    "Mark funded… button, amount box, Save funded, Cancel",
    "Close round button",
  ]),
  group("desks-a.json", "client-control-panel.html", [
    "e2e/bank-amount-suggestion.spec.mjs",
    "e2e/funded-amount.spec.mjs",
  ], [
    "Lender row: Approved $ amount input",
    "Lender row: Approved button",
    "Lender row: Declined button",
    "Lender row: Doesn't count / Count again button (exclude or reinstate an approval, asks for a reason)",
    "Bank email amount suggestion buttons (one click fills the amount box)",
  ]),
  group("desks-a.json", "closer-dashboard.html", [
    "e2e/closer-dashboard-calculators.spec.mjs",
  ], [
    "Payment Calculator details toggle",
    "Deal calculator: Draw amount input",
    "Deal calculator: draw slider",
    "Deal calculator: utilization guard % input",
    "Deal calculator: Deposit input",
    "Deal calculator: Success fee % input",
    "Deal calculator: Debts to clear input",
    "Deal calculator: Minimum payment % input",
  ]),
  group("desks-b.json", "finance-os.html", [
    "e2e/finance-os-staff-clicks.spec.mjs",
  ], [
    "Find a client box (filters the list as you type)",
    "Open this client button (reloads with ?client_id=)",
    "Close this client button (forgets fh_client in localStorage, reloads bare)",
    "Paydown simulator: Cash on hand box and Split this cash button",
  ]),
  group("desks-b.json", "financeos.html#helper", [
    "e2e/financeos-tabs-clicks.spec.mjs",
  ], [
    "Send: message box, Send button, Enter key (20,000 character cap)",
    "Suggestion buttons (3: due this week, which card first, got declined paste the letter)",
  ]),
  group("desks-b.json", "financeos.html#next", [
    "e2e/financeos-tabs-clicks.spec.mjs",
  ], [
    "'Do task' button on a step the helper or a person can do",
    "'I'm ready to get funded' button (opens the Capital Blueprint closing-prep call task)",
  ]),
  group("desks-b.json", "financeos.html#alerts", [
    "e2e/financeos-tabs-clicks.spec.mjs",
  ], [
    "On/off switch for each of the four alerts (payment timing, promo ending, cash cushion, new credit)",
  ]),
  group("desks-b.json", "content-admin.html", [
    "e2e/content-admin-clicks.spec.mjs",
  ], [
    "Save changes button (saves tiles and the tier-to-video map)",
    "Locked tile editor: Showing/Hidden switch per tile (keyboard Space/Enter too)",
    "Locked tile editor: client-facing name box",
    "Locked tile editor: outcome copy box (one line shown to the client)",
    "Locked tile editor: price shown box",
    "Tier assignment: one welcome-video select per product tier and one for Default",
    "Upload welcome video: Choose file button and drag-and-drop box",
    "Upload welcome video: Title, Duration, Assign to tier",
    "Upload welcome video: Upload button (then saves the tier map)",
    "Upload welcome video: Clear button",
  ]),
  group("desks-b.json", "contracts.html", [
    "e2e/contracts-wording-clicks.spec.mjs",
  ], [
    "Page itself loads; lists contract wordings",
    "Wording list: click a row to edit it",
    "New wording button and editor boxes: short name, name, type, filing label, the words, signature sentence",
    "Editor: 'Blanks you fill in when sending' rows (key, label, needed) and Add a blank / x",
    "Save (create a new wording)",
    "Save (edit an existing wording)",
    "PDF editor: drag on a page to draw a box; click a box to select; drag to move; drag corner to resize",
    "PDF editor: field type chips (Text, Date, Tick box, Signature, Initials), Belongs to, Filled from, selected-box name / kind / signer / source / must-fill / Remove",
    "PDF editor: Add a signer",
    "PDF editor: Save boxes",
  ]),
  group("desks-b.json", "consent-capture.html", [
    "e2e/consent-capture-clicks.spec.mjs",
  ], [
    "Consent wording, version badge and current status banner (read from the server, never typed in the page)",
    "How did they agree: 'They typed their name' / 'They ticked a box' / 'They signed' buttons",
    "Name box, Expires date box",
    "Signature pad (draw) and its Clear button; empty pad refused",
    "Record consent: call_recording",
    "Record consent: marketing_use (permission to use what the client said in ads)",
    "History table: 'live / not live' state and Withdraw button (asks for a reason in a prompt)",
  ]),
  group("desks-b.json", "documents.html", [
    "e2e/documents-clicks.spec.mjs",
  ], [
    "Contract cell: Remind button (re-sends the signing request to one signer)",
    "Contract cell: Void button (asks for a reason in a prompt; owner/admin only)",
    "Result strip under the table (server's own words after Remind, Void, Open, Download)",
  ]),
  group("desks-b.json", "csm-queue.html", [
    "e2e/csm-queue-clicks.spec.mjs",
  ], [
    "Interview form: 'How did you speak to them' select, one answer box per question, 'Anything else' notes box",
    "Save these answers button (needs at least one answer)",
    "Banner area (success and error messages for shift, claim, save)",
  ]),
  group("desks-b.json", "galaxy.html", [
    "e2e/galaxy-clicks.spec.mjs",
  ], [
    "Sky: click a cluster (team) to zoom in, click a worker to open the day panel, click empty space to pull back; hover shows the pointer",
    "Escape key (zoom out) and the panel's 'esc' close button",
    "Worker day panel: pace, 'Right now', presence, 'Output today' rows, 'Total events', today timeline, files touched (client names)",
    "Notice bar ('Sign in required', 'Activity feed failed', 'No workers yet', 'Live')",
  ]),
  group("desks-c.json", "messaging.html", [
    "e2e/messaging-inbox.spec.mjs",
  ], [
    "Page load: inbox read (Needs-reply tab first), refreshes on a timer while the tab is visible",
    "Conversation list row: click opens the thread",
    "Held-for-quiet-hours result: text deferred to the next window and the words stay in the box",
    "Blocked result: opt-out or restricted wording refused and a task raised for a human",
  ]),
  group("desks-c.json", "inquiry-remover.html", [
    "e2e/specialist-desk.spec.mjs",
  ], [
    "Work queue table: one row per disputed inquiry line (Client, Bureau, Actual, Expected, Call state, Hold, Attempts, Status)",
    "Work row: click or Enter expands the work strip; loads attempt history and the masked identity line",
    "Work strip: 'Mark confirmed' button (confirms removal; sets confirmed_at)",
    "Repair row: click or Enter expands the file (items, letters this round, what is next, timeline)",
  ]),
  group("desks-c.json", "marketing-command-center.html", [
    "e2e/cc-tab-launch.spec.mjs",
  ], [
    "Frame: cost sheet and two-tap confirm sheet drawn before every paid tap (Cancel / yes)",
    "Launch: 'Turn on' per loaded ad (two taps; names ad, ad set, daily budget, any pause above; disabled while budget unknown)",
  ]),
  group("desks-c.json", "marketing-command-center.html", [
    "e2e/marketing-cc-settings.spec.mjs",
  ], [
    "Settings: weekly switch 'Write scripts every week' (two taps; second names the cost caps)",
    "Settings: model spend caps: month cap and run caps (warns when under what is spent)",
  ]),
  group("desks-e.json", "public/app/money-transfers.html", [
    "e2e/money-transfers-clicks.spec.mjs",
  ], [
    "From account picker (select when 2 or more accounts, fixed text when 1)",
    "Review this move (button, reveals the exact sentence and locks the picker)",
    "Go back (button, hides the sentence, unlocks the picker)",
    "Yes, move $X (the one filled button, form submit)",
    "Not now (button on a waiting card, confirm dialog)",
    "Take it off the list (staff button on a waiting card, confirm dialog)",
    "Stop this move (history row button, only while it has not reached the bank)",
    "Set up this move (staff form: To, Suggested from, Amount, Date, What it is for)",
  ]),
  group("desks-e.json", "public/app/ops-admin.html", [
    "e2e/ops-admin-outbound.spec.mjs",
  ], [
    "Send what is waiting (button, confirm dialog: goes to real clients, cannot be pulled back)",
    "Pause sending / Turn sending on (button, confirm dialog)",
    "Email unsent invoices (button, confirm dialog; shown only when invoices were never emailed)",
    "email_invoice_backlog (server): emails every invoice the client was never told about, bounded to 200",
  ]),
  group("desks-e.json", "public/app/pipeline.html", [
    "e2e/pipeline-new-archive.spec.mjs",
  ], [
    "New Client (button opens the modal: name, email, phone, product with 6 choices; Save / Cancel; same save as the apply form)",
    "pipeline-clients (server): creates or finds the client through the funnel door and emits entry.captured, which sends the welcome email and text and places the Sales card",
    "Card: click the card body (opens the right-hand client drawer)",
    "Card: DEL button then modal 'Archive this contact?' (type DELETE, Archive / Cancel)",
    "Drawer: Archive and Close buttons, Escape key",
  ]),
  group("desks-e.json", "public/app/pipeline.html", [
    "e2e/pipeline.spec.mjs",
  ], [
    "Card: drag the card (pointer) to another column on the same rail",
    "Card: MOVE button (opens the route menu for that card)",
  ]),
  group("desks-e.json", "public/app/pipeline.html", [
    "e2e/funded-amount.spec.mjs",
  ], [
    "Funded amount prompt (window.prompt, up to 3 tries; blank or cancel abandons the move, never sends zero)",
  ]),
  group("desks-f.json", "products-commissions.html", [
    "e2e/products-commissions-ledger.spec.mjs",
  ], [
    "Page open: commission ledger (ACCRUED and PAID MTD tiles, payout table)",
    "Page open: commission rules and versions",
    "Commission rule 'Change rate' (opens the new-rate line)",
    "Commission rule 'Close v<N> - open v<N+1>': saves a new effective-dated rate and reason",
    "Commission rule 'Cancel' (closes the new-rate line)",
    "Ledger select-all checkbox and per-row checkboxes (Accrued and Approved rows only)",
    "'Approve selected': moves Accrued rows to Approved",
    "'Mark paid...': asks for the ACH / check / payroll id, marks Approved rows Paid (records only, moves no money)",
    "Ledger table (date, person, client, product, rule version, basis, rate, payout, status)",
  ]),
  group("desks-f.json", "soft-pull-approve.html", [
    "e2e/soft-pull-approve-clicks.spec.mjs",
  ], [
    "Link wall: 'This page needs a full link' / 'Link problem' (missing field, bad signature, expired link, no server)",
    "Form fields: full legal name, SSN, date of birth, street, city, state, ZIP",
    "'+ Add a business' (up to 20) and per-business 'Remove'",
    "Business fields: name, street, city, state, ZIP, EIN, incorporated month, extra owner",
    "Running total line ('Total due: $32 + n x $10')",
    "Result screen when no checkout came back ('Ask your advisor for the pay link')",
  ]),
  group("desks-f.json", "staff-teams.html", [
    "e2e/staff-teams.spec.mjs",
  ], [
    "'Permissions ->' button on the roster header",
  ]),
  group("desks-f.json", "teleprompter-remote.html (+ teleprompter-remote.js)", [
    "e2e/teleprompter-remote-clicks.spec.mjs",
  ], [
    "No-key / closed-link / offline messages ('This link has no film key', 'did not open', 'No connection')",
    "Script select (shown with 2 or more scripts)",
  ]),
  group("desks-a.json", "client-portal.html", [
    "e2e/portal-refer-a-friend.spec.mjs",
  ], [
    "Refer a friend: Get my link button",
  ]),
]);

export const STAFF_UI_SPECS = Object.freeze([
  ...new Set(STAFF_UI_GROUPS.flatMap((entry) => entry.specs)),
].sort());

export const STAFF_UI_PROOF_CASES = Object.freeze(STAFF_UI_GROUPS.flatMap((entry) =>
  entry.controls.map((control) => {
    const matches = rowsFor(entry.sourceFile).filter(
      (row) => row.surface === entry.surface && row.control === control,
    );
    if (matches.length !== 1) {
      throw new Error(`Expected one staff display row for ${entry.sourceFile} / ${entry.surface} / ${control}, found ${matches.length}`);
    }
    return Object.freeze({
      sourceFile: entry.sourceFile,
      surface: entry.surface,
      control,
      depth: "e2e",
      evidence: `${TEST_FILE} (runs ${entry.specs.join(", ")})`,
      tests: Object.freeze([TEST_FILE]),
    });
  }),
));
