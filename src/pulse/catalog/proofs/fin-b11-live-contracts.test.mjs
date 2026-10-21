// Batch 11 live checks, tested. These are practice tests OF the checks: the real SQL text runs over
// stand-in rows (fin-b11-sql-kit.mjs), a healthy set is counted clean, and each single break is counted
// as exactly one wrong result. The live check on the server reads real rows; this proves the text it
// runs goes red when the saved result is wrong and stays green when it is right.
//
// For every check:
//   * a healthy set counts its rows and none is wrong
//   * each named condition has a stand-in row that breaks only that condition, and it is counted wrong
//   * the same rows in another company are never counted
//   * dropping any one condition from the text changes the answer for some stand-in row, so no
//     condition is dead weight
//   * rows the check must leave alone (too new, too old, touched since, loader rows) are not counted

import { test } from "node:test";
import assert from "node:assert/strict";

import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";
import {
  FIN_B11_CHECKS, FIN_B11_RESULT_CONTRACTS, FIN_B11_ROWS, sqlFor
} from "./fin-b11-display-contracts.mjs";
import { makeStandIn, tablesIn, NOW } from "./fin-b11-sql-kit.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const MIN = 1;
const HOUR = 60;
const DAY = 24 * 60;

const clone = (v) => JSON.parse(JSON.stringify(v));
const find = (rows, id) => rows.find((r) => r.id === id);
const drop = (rows, id) => rows.splice(rows.findIndex((r) => r.id === id), 1);

// Fixture: { tables: {table: rows[]}, sample: n, breaks: {condition: [[label, fn, wantBad?]]}, ignored: [[label, fn]] }.
// fn mutates a fresh clone of the healthy tables. A break must leave exactly one wrong row unless
// wantBad says otherwise.
const FIXTURES = new Map();

// ── brain-turns ─────────────────────────────────────────────────────────────
{
  const thread = (id, over = {}) => ({ id, org_id: ORG, staff_id: u(900), title: "A question", created_at: ago(DAY), updated_at: ago(2 * HOUR), ...over });
  const msg = (id, thread_id, role, over = {}) => ({
    id, org_id: ORG, thread_id, role, text: role === "user" ? "How do I send a contract?" : "Open the client and press Send.",
    sources: [], answer_source: role === "user" ? null : "model", thin: false, created_at: ago(2 * HOUR + 5), ...over
  });
  FIXTURES.set("brain-turns", {
    tables: {
      brain_threads: [thread(u(1)), thread(u(2)), thread(u(3))],
      brain_messages: [
        msg(u(11), u(1), "user"), msg(u(12), u(1), "assistant"),
        msg(u(21), u(2), "user"), msg(u(22), u(2), "assistant", { answer_source: "extractive", thin: true }),
        msg(u(31), u(3), "user"), msg(u(32), u(3), "assistant", { answer_source: "none", thin: true })
      ]
    },
    sample: 3,
    breaks: {
      "a question has no saved answer": [["answer never saved", (t) => drop(t.brain_messages, u(12))]],
      "an answer is blank or names no engine": [
        ["blank answer", (t) => { find(t.brain_messages, u(12)).text = "   "; }],
        ["no engine named", (t) => { find(t.brain_messages, u(22)).answer_source = null; }],
        ["an engine nobody knows", (t) => { find(t.brain_messages, u(12)).answer_source = "guess"; }]
      ],
      "an answer's thin flag disagrees with its engine": [
        ["model answer marked thin", (t) => { find(t.brain_messages, u(12)).thin = true; }],
        ["extractive answer marked full", (t) => { find(t.brain_messages, u(22)).thin = false; }]
      ],
      "a saved question is blank": [["blank question", (t) => { find(t.brain_messages, u(11)).text = ""; }]]
    },
    ignored: [
      ["a chat changed a minute ago may still be getting its answer", (t) => {
        find(t.brain_threads, u(1)).updated_at = ago(MIN);
        drop(t.brain_messages, u(12));
      }],
      ["a chat older than 60 days", (t) => {
        find(t.brain_threads, u(1)).updated_at = ago(61 * DAY);
        drop(t.brain_messages, u(12));
      }]
    ]
  });
}

// ── brain-past-chats ────────────────────────────────────────────────────────
{
  const thread = (id, over = {}) => ({ id, org_id: ORG, staff_id: u(900), title: "A chat", created_at: ago(DAY), updated_at: ago(30), ...over });
  const msg = (id, thread_id, over = {}) => ({ id, org_id: ORG, thread_id, role: "user", text: "q", created_at: ago(40), ...over });
  FIXTURES.set("brain-past-chats", {
    tables: {
      brain_threads: [thread(u(1)), thread(u(2), { staff_id: u(901) })],
      brain_messages: [msg(u(11), u(1)), msg(u(12), u(1), { role: "assistant", created_at: ago(35) }), msg(u(21), u(2))],
      staff: [{ id: u(900), org_id: ORG, role: "closer" }, { id: u(901), org_id: ORG, role: "csm" }]
    },
    sample: 2,
    breaks: {
      "a message sits in another company": [["message in another company", (t) => { find(t.brain_messages, u(11)).org_id = OTHER; }]],
      "the list order is behind the newest message": [["thread older than its newest message", (t) => { find(t.brain_threads, u(1)).updated_at = ago(HOUR); }]],
      "the chat belongs to a staff member of another company": [["staff member of another company", (t) => { find(t.staff, u(900)).org_id = OTHER; }]]
    },
    ignored: [
      ["a chat whose staff member was removed is allowed to stay", (t) => { drop(t.staff, u(901)); }],
      ["a chat with no messages", (t) => { drop(t.brain_messages, u(21)); }]
    ]
  });
}

// ── brain-uploads ───────────────────────────────────────────────────────────
{
  const file = (id, over = {}) => ({
    id, org_id: ORG, drive_file_id: `upload:${id}`, name: "Policy.pdf", source: "upload", approval_status: "pending",
    classification_status: "pending", access_tier: "owner", proposed_tier: "staff", uploaded_by: u(900), size_bytes: 4096,
    original_name: "Policy.pdf", created_at: ago(DAY), updated_at: ago(DAY), ...over
  });
  const chunk = (id, file_id, tier) => ({ id, org_id: ORG, file_id, chunk_index: 0, content: "words", access_tier: tier });
  FIXTURES.set("brain-uploads", {
    tables: {
      brain_files: [
        file(u(1)),
        file(u(2), { approval_status: "approved", classification_status: "approved", access_tier: "staff", proposed_tier: "staff" }),
        file(u(3), { approval_status: "rejected", classification_status: "rejected", access_tier: "owner", proposed_tier: "owner" })
      ],
      brain_chunks: [chunk(u(11), u(1), "owner"), chunk(u(12), u(2), "staff"), chunk(u(13), u(3), "owner")],
      brain_classification_reviews: [
        { id: u(21), org_id: ORG, file_id: u(1), drive_file_id: `upload:${u(1)}`, status: "pending", kind: "upload", proposed_tier: "staff", created_at: ago(DAY), updated_at: ago(DAY) }
      ]
    },
    sample: 3,
    breaks: {
      "no staff member is named as the uploader": [["uploaded_by empty", (t) => { find(t.brain_files, u(2)).uploaded_by = null; }]],
      "the file has no bytes or no name": [
        ["zero bytes", (t) => { find(t.brain_files, u(2)).size_bytes = 0; }],
        ["unknown size", (t) => { find(t.brain_files, u(2)).size_bytes = null; }],
        ["blank name", (t) => { find(t.brain_files, u(2)).name = " "; }]
      ],
      "the file id is not an upload id": [["a drive id on an upload", (t) => { find(t.brain_files, u(2)).drive_file_id = "1AbCdEf"; }]],
      "a waiting file is not closed to non-owners": [["pending at sales", (t) => { find(t.brain_files, u(1)).access_tier = "sales"; }]],
      "a waiting or turned-down file has an open chunk": [
        ["pending file, chunk at staff", (t) => { find(t.brain_chunks, u(11)).access_tier = "staff"; }],
        ["rejected file, chunk at public", (t) => { find(t.brain_chunks, u(13)).access_tier = "public"; }]
      ],
      "an approved file is not at its approved tier": [
        ["tier still owner", (t) => { find(t.brain_files, u(2)).access_tier = "owner"; }],
        ["classification never approved", (t) => { find(t.brain_files, u(2)).classification_status = "pending"; }]
      ],
      "a waiting file has no pending review, so nobody can approve it": [["review gone", (t) => { drop(t.brain_classification_reviews, u(21)); }]]
    },
    ignored: [
      ["a file added two minutes ago may still be getting its review", (t) => {
        find(t.brain_files, u(1)).created_at = ago(2 * MIN);
        drop(t.brain_classification_reviews, u(21));
      }],
      ["a drive file is not in this list", (t) => { find(t.brain_files, u(2)).source = "drive"; find(t.brain_files, u(2)).uploaded_by = null; }]
    ]
  });
}

// ── brain-review-queue ──────────────────────────────────────────────────────
{
  const file = (id, over = {}) => ({
    id, org_id: ORG, drive_file_id: `upload:${id}`, name: "f", source: "upload", approval_status: "pending",
    classification_status: "pending", access_tier: "owner", proposed_tier: "staff", ...over
  });
  const review = (id, file_id, over = {}) => ({
    id, org_id: ORG, file_id, drive_file_id: "x", status: "pending", kind: "upload", proposed_tier: "staff", created_at: ago(DAY), updated_at: ago(DAY), ...over
  });
  FIXTURES.set("brain-review-queue", {
    tables: {
      brain_files: [file(u(1)), file(u(2), { source: "drive", approval_status: "approved" })],
      brain_chunks: [
        { id: u(11), org_id: ORG, file_id: u(1), chunk_index: 0, content: "c", access_tier: "owner" },
        { id: u(12), org_id: ORG, file_id: u(2), chunk_index: 0, content: "c", access_tier: "owner" }
      ],
      brain_classification_reviews: [review(u(21), u(1)), review(u(22), u(2), { kind: "classification", proposed_tier: "affiliate" })]
    },
    sample: 2,
    breaks: {
      "the file is missing or belongs to another company": [
        ["file missing", (t) => { drop(t.brain_files, u(1)); }],
        ["file in another company", (t) => { find(t.brain_files, u(1)).org_id = OTHER; }]
      ],
      "the file is already open to a lower tier": [["tier already sales", (t) => { find(t.brain_files, u(2)).access_tier = "sales"; }]],
      "a chunk of the file is already open to a lower tier": [["chunk at public", (t) => { find(t.brain_chunks, u(11)).access_tier = "public"; }]],
      "an upload review is on a file that is not a waiting upload": [
        ["upload already approved", (t) => { find(t.brain_files, u(1)).approval_status = "approved"; }],
        ["review says upload on a drive file", (t) => { find(t.brain_files, u(1)).source = "drive"; }]
      ],
      "a drive review is on a file that is not marked pending": [["drive file already auto classified", (t) => { find(t.brain_files, u(2)).classification_status = "auto"; }]]
    },
    ignored: [
      ["a decided review is not in the queue", (t) => { find(t.brain_classification_reviews, u(21)).status = "approved"; find(t.brain_files, u(1)).access_tier = "sales"; }]
    ]
  });
}

// ── brain-review-approved / brain-review-rejected ───────────────────────────
function decisionFixture(kind) {
  const approved = kind === "approved";
  const file = (id, over = {}) => ({
    id, org_id: ORG, drive_file_id: `upload:${id}`, name: "f", source: "upload",
    approval_status: approved ? "approved" : "rejected", classification_status: approved ? "approved" : "rejected",
    access_tier: approved ? "staff" : "owner", proposed_tier: approved ? "staff" : "owner", updated_at: ago(2 * DAY + 1), created_at: ago(5 * DAY), ...over
  });
  const review = (id, file_id, decided_by, over = {}) => ({
    id, org_id: ORG, file_id, drive_file_id: "x", status: kind, kind: "upload", proposed_tier: approved ? "staff" : "owner",
    decided_by, decided_at: ago(2 * DAY), created_at: ago(3 * DAY), updated_at: ago(2 * DAY), ...over
  });
  const chunk = (id, file_id, tier) => ({ id, org_id: ORG, file_id, chunk_index: 0, content: "c", access_tier: tier });
  const tables = {
    brain_files: [file(u(1)), file(u(2), approved ? { access_tier: "affiliate", proposed_tier: "affiliate" } : {})],
    brain_chunks: [chunk(u(11), u(1), approved ? "staff" : "owner"), chunk(u(12), u(2), approved ? "affiliate" : "owner")],
    brain_classification_reviews: [
      review(u(21), u(1), u(900)),
      review(u(22), u(2), u(901), approved ? { proposed_tier: "affiliate" } : {})
    ],
    brain_affiliate_allowlist: approved
      ? [{ org_id: ORG, file_id: u(2), drive_file_id: "x", review_id: u(22), approved_by: u(901) }]
      : [],
    staff: [{ id: u(900), org_id: ORG, role: "owner" }, { id: u(901), org_id: ORG, role: "owner" }]
  };
  const common = {
    "the decider is not an owner of this company": [
      ["decider is now an admin", (t) => { find(t.staff, u(900)).role = "admin"; }],
      ["decider is an owner of another company", (t) => { find(t.staff, u(900)).org_id = OTHER; }],
      ["decider is not a staff member at all", (t) => { drop(t.staff, u(900)); }]
    ],
    "the file is gone": [["file deleted", (t) => { drop(t.brain_files, u(1)); }]]
  };
  const ignored = [
    ["a newer review exists for the file", (t) => {
      t.brain_classification_reviews.push({ id: u(23), org_id: ORG, file_id: u(1), drive_file_id: "x", status: "pending", kind: "upload", proposed_tier: "staff", created_at: ago(DAY), updated_at: ago(DAY) });
      find(t.brain_files, u(1)).access_tier = "public";
    }],
    ["the file was changed after the decision", (t) => { find(t.brain_files, u(1)).updated_at = ago(10); find(t.brain_files, u(1)).access_tier = "public"; }],
    ["a decision older than 90 days", (t) => {
      find(t.brain_classification_reviews, u(21)).updated_at = ago(91 * DAY);
      find(t.brain_files, u(1)).updated_at = ago(92 * DAY);
      find(t.brain_files, u(1)).access_tier = "public";
    }],
    ["another company's decision", (t) => { find(t.brain_classification_reviews, u(21)).org_id = OTHER; find(t.brain_files, u(1)).access_tier = "public"; }]
  ];
  if (approved) {
    return {
      tables, sample: 2, ignored,
      breaks: {
        ...common,
        "the decision has no time or no person": [
          ["no person", (t) => { find(t.brain_classification_reviews, u(21)).decided_by = null; }],
          ["no time", (t) => { find(t.brain_classification_reviews, u(21)).decided_at = null; }]
        ],
        "the file is not approved at the tier asked for": [
          ["file still pending", (t) => { find(t.brain_files, u(1)).approval_status = "pending"; }],
          ["classification not approved", (t) => { find(t.brain_files, u(1)).classification_status = "pending"; }],
          ["file at a different tier", (t) => { find(t.brain_files, u(1)).access_tier = "sales"; }],
          ["proposed tier not carried", (t) => { find(t.brain_files, u(1)).proposed_tier = "owner"; }]
        ],
        "a chunk is not at the approved tier": [["chunk still owner", (t) => { find(t.brain_chunks, u(11)).access_tier = "owner"; }]],
        "an affiliate approval has no allowlist row for this review and owner": [
          ["allowlist row missing", (t) => { t.brain_affiliate_allowlist.length = 0; }],
          ["allowlist row for another review", (t) => { t.brain_affiliate_allowlist[0].review_id = u(99); }],
          ["allowlist row approved by someone else", (t) => { t.brain_affiliate_allowlist[0].approved_by = u(900); }],
          ["allowlist row in another company", (t) => { t.brain_affiliate_allowlist[0].org_id = OTHER; }]
        ],
        "a non-affiliate approval left an allowlist row behind": [
          ["allowlist row on a staff approval", (t) => { t.brain_affiliate_allowlist.push({ org_id: ORG, file_id: u(1), drive_file_id: "x", review_id: u(21), approved_by: u(900) }); }]
        ]
      }
    };
  }
  return {
    tables, sample: 2, ignored: [
      ...ignored,
      ["an auto-closed review has no person and is not an owner's decision", (t) => {
        t.brain_classification_reviews.push({ id: u(24), org_id: ORG, file_id: u(3), drive_file_id: "x", status: "rejected", kind: "classification", proposed_tier: "owner", decided_by: null, decided_at: ago(DAY), created_at: ago(DAY), updated_at: ago(DAY) });
        t.brain_files.push(file(u(3), { approval_status: "approved", classification_status: "auto", access_tier: "public" }));
      }],
      ["a review replaced by a newer proposal is closed with no person, and its file waits on the new one", (t) => {
        t.brain_classification_reviews.push({ id: u(25), org_id: ORG, file_id: u(4), drive_file_id: "x", status: "rejected", kind: "upload", proposed_tier: "staff", decided_by: null, decided_at: ago(DAY), created_at: ago(DAY), updated_at: ago(DAY) });
        t.brain_files.push(file(u(4), { approval_status: "pending", classification_status: "pending", access_tier: "owner" }));
      }]
    ],
    breaks: {
      ...common,
      "the decision has no time or no person": [
        ["no time", (t) => { find(t.brain_classification_reviews, u(21)).decided_at = null; }],
        // The reject path stopped saving who decided: the file says a person turned it down and the review names nobody.
        ["no person", (t) => { find(t.brain_classification_reviews, u(21)).decided_by = null; }]
      ],
      "the file is not marked rejected and closed": [
        ["file not rejected", (t) => { find(t.brain_files, u(1)).approval_status = "approved"; }],
        ["classification not rejected", (t) => { find(t.brain_files, u(1)).classification_status = "pending"; }],
        ["file left open", (t) => { find(t.brain_files, u(1)).access_tier = "sales"; }],
        ["proposed tier not reset", (t) => { find(t.brain_files, u(1)).proposed_tier = "affiliate"; }]
      ],
      "a chunk is open to a lower tier": [["chunk at public", (t) => { find(t.brain_chunks, u(11)).access_tier = "public"; }]],
      "an affiliate allowlist row was left behind": [
        ["allowlist row still there", (t) => { t.brain_affiliate_allowlist.push({ org_id: ORG, file_id: u(1), drive_file_id: "x", review_id: u(21), approved_by: u(900) }); }]
      ]
    }
  };
}
FIXTURES.set("brain-review-approved", decisionFixture("approved"));
FIXTURES.set("brain-review-rejected", decisionFixture("rejected"));

// ── script-save ─────────────────────────────────────────────────────────────
{
  const script = (id, over = {}) => ({
    id, org_id: ORG, partner_id: u(500), version: 1, parent_script_id: null, root_script_id: id, title: null, body: "words",
    script_type: null, angle_key: "denial_angle", hook_key: null, offer_key: null, source: "chris", ad_id: null,
    parts: null, batch_id: null, idea_id: null, archived_at: null, created_at: ago(10 * DAY), ...over
  });
  FIXTURES.set("script-save", {
    tables: {
      partners: [{ id: u(500), org_id: ORG, slug: "fundhub-house", name: "House" }],
      ad_scripts: [
        script(u(1), { archived_at: ago(5 * DAY) }),
        script(u(2), { version: 2, parent_script_id: u(1), root_script_id: u(1), created_at: ago(5 * DAY) })
      ],
      ad_labels: [{ id: u(700), org_id: ORG, kind: "angle", key: "denial_angle" }]
    },
    sample: 2,
    breaks: {
      "the partner is missing or belongs to another company": [
        ["partner in another company", (t) => { find(t.partners, u(500)).org_id = OTHER; }, 2],
        ["partner row gone", (t) => { drop(t.partners, u(500)); }, 2]
      ],
      "an original is not its own root": [["root is a different script", (t) => { find(t.ad_scripts, u(1)).root_script_id = u(99); }, 2]],
      "a rewrite points at a script that is missing or belongs to another company or partner": [
        ["parent missing", (t) => { find(t.ad_scripts, u(2)).parent_script_id = u(98); }],
        ["parent in another partner", (t) => {
          t.partners.push({ id: u(501), org_id: ORG, slug: "p2", name: "P2" });
          find(t.ad_scripts, u(1)).partner_id = u(501);
        }]
      ],
      "a rewrite is not the next version": [["version skipped", (t) => { find(t.ad_scripts, u(2)).version = 3; }]],
      "a rewrite sits on another root": [["root differs from the parent's", (t) => { find(t.ad_scripts, u(2)).root_script_id = u(97); }]],
      "the script a rewrite replaced is still live": [["parent not archived", (t) => { find(t.ad_scripts, u(1)).archived_at = null; }]],
      "a label typed on the form is not in the dictionary": [
        ["angle missing from the dictionary", (t) => { t.ad_labels.length = 0; }],
        ["hook missing from the dictionary", (t) => { find(t.ad_scripts, u(1)).hook_key = "cold_open"; }]
      ]
    },
    ignored: [
      ["a loader script (it names an ad number) needs no dictionary row", (t) => { t.ad_labels.length = 0; find(t.ad_scripts, u(1)).ad_id = u(1234); }],
      // Demo partners are left out, as in the sibling brand, social and recording checks.
      ["the script belongs to a demo partner", (t) => { find(t.partners, u(500)).is_demo = true; find(t.ad_scripts, u(1)).root_script_id = u(99); }],
      ["a script older than 60 days", (t) => {
        t.ad_scripts.push({ id: u(3), org_id: ORG, partner_id: u(999), version: 1, parent_script_id: null, root_script_id: u(98),
          body: "old", source: "chris", created_at: ago(61 * DAY) });
      }],
      ["a rewrite from before the 2026-10-05 archive rule may leave its parent live", (t) => {
        find(t.ad_scripts, u(2)).created_at = "2026-10-01T00:00:00.000Z";
        find(t.ad_scripts, u(1)).archived_at = null;
      }]
    ]
  });
}

// ── job-enqueued ────────────────────────────────────────────────────────────
{
  const job = (id, over = {}) => ({
    id, org_id: ORG, partner_id: u(500), status: "queued", attempt: 0, spec: { assetKind: "copy", offerType: "funding" },
    idempotency_key: `batch-${id}`, created_at: ago(DAY), updated_at: ago(DAY), requested_by_kind: null, brand_kit_id: null, ...over
  });
  FIXTURES.set("job-enqueued", {
    tables: {
      partners: [{ id: u(500), org_id: ORG, slug: "p", name: "P" }],
      staff: [{ id: u(900), org_id: ORG, role: "owner" }],
      accounts: [{ id: u(800), kind: "partner", partner_id: u(500) }],
      ad_scripts: [{ id: u(600), org_id: ORG, partner_id: u(500), body: "b" }],
      brand_kits: [{ id: u(700), org_id: ORG, partner_id: u(500), name: "Kit" }],
      generation_jobs: [
        job(u(1), { requested_by_kind: "staff", requested_by_staff_id: u(900), spec: { assetKind: "copy", offerType: "funding", scriptId: u(600) }, brand_kit_id: u(700) }),
        job(u(2), { requested_by_kind: "partner", requested_by_account_id: u(800) })
      ]
    },
    sample: 2,
    breaks: {
      "the partner is missing or belongs to another company": [
        ["partner in another company", (t) => { find(t.partners, u(500)).org_id = OTHER; }, 2],
        ["partner gone", (t) => { drop(t.partners, u(500)); }, 2]
      ],
      "the staff asker is not a staff member of this company": [
        ["asker in another company", (t) => { find(t.staff, u(900)).org_id = OTHER; }],
        ["asker not a staff member", (t) => { drop(t.staff, u(900)); }]
      ],
      "the partner asker is not an account of this partner": [
        ["account of another partner", (t) => { find(t.accounts, u(800)).partner_id = u(501); }],
        ["account gone", (t) => { drop(t.accounts, u(800)); }]
      ],
      "the script it names is not this partner's": [
        ["script of another partner", (t) => { find(t.ad_scripts, u(600)).partner_id = u(501); }],
        ["script of another company", (t) => { find(t.ad_scripts, u(600)).org_id = OTHER; }],
        ["script gone", (t) => { drop(t.ad_scripts, u(600)); }]
      ],
      "the brand kit it names is not this partner's": [
        ["kit of another partner", (t) => { find(t.brand_kits, u(700)).partner_id = u(501); }],
        ["kit gone", (t) => { drop(t.brand_kits, u(700)); }]
      ]
    },
    ignored: [
      ["a job older than 60 days", (t) => { find(t.generation_jobs, u(1)).created_at = ago(61 * DAY); drop(t.staff, u(900)); }],
      ["an unattributed job (the cron) has no asker to check", (t) => { find(t.generation_jobs, u(2)).requested_by_kind = null; find(t.generation_jobs, u(2)).requested_by_account_id = null; drop(t.accounts, u(800)); }]
    ]
  });
}

// ── job-form ────────────────────────────────────────────────────────────────
{
  const job = (id, spec, over = {}) => ({
    id, org_id: ORG, partner_id: u(500), status: "queued", attempt: 0, spec, idempotency_key: `batch-${id}`,
    created_at: ago(DAY), updated_at: ago(DAY), ...over
  });
  FIXTURES.set("job-form", {
    tables: {
      generation_jobs: [
        job(u(1), { assetKind: "static", offerType: "funding", prompt: "Working capital", formats: ["1x1"], variants: 1 }),
        job(u(2), { assetKind: "copy", offerType: "credit_cards", prompt: "", scriptId: u(600), formats: ["1x1"], variants: 1 }),
        // The rest of the allowed set: the rewrite-a-shape kind and the credit repair offer.
        job(u(3), { assetKind: "resize", offerType: "credit_repair", prompt: "Make it wide", formats: ["16x9"], variants: 2 }),
        job(u(4), { assetKind: "video", offerType: "funding", prompt: "A 20 second spot", formats: ["9x16"], variants: 1 })
      ]
    },
    sample: 4,
    breaks: {
      "the kind is missing or unknown": [
        ["kind missing", (t) => { delete find(t.generation_jobs, u(1)).spec.assetKind; }],
        ["kind unknown", (t) => { find(t.generation_jobs, u(1)).spec.assetKind = "gif"; }]
      ],
      "the offer is missing or not one the screen accepts": [
        ["offer missing", (t) => { delete find(t.generation_jobs, u(1)).spec.offerType; }],
        ["offer unknown", (t) => { find(t.generation_jobs, u(1)).spec.offerType = "crypto"; }]
      ],
      "a picked script id is the wrong length": [["script id cut short", (t) => { find(t.generation_jobs, u(2)).spec.scriptId = "abc123"; }]],
      "the words of what to make, the shapes or the versions are missing from a job the form made": [
        ["the words of what to make were not sent", (t) => { delete find(t.generation_jobs, u(1)).spec.prompt; }],
        ["the shapes were not sent", (t) => { delete find(t.generation_jobs, u(1)).spec.formats; }],
        ["the number of versions was not sent", (t) => { delete find(t.generation_jobs, u(1)).spec.variants; }],
        ["the words are empty text, which the form allows, but the shapes are gone", (t) => { delete find(t.generation_jobs, u(2)).spec.formats; }]
      ],
      "the batch name is blank or was saved with spaces around it": [
        ["blank batch name", (t) => { find(t.generation_jobs, u(1)).idempotency_key = "   "; }],
        ["batch name saved with spaces around it", (t) => { find(t.generation_jobs, u(1)).idempotency_key = "  oct-batch  "; }]
      ]
    },
    ignored: [
      ["a job from before the offer rule (2026-09-08) may lack an offer", (t) => {
        find(t.generation_jobs, u(1)).created_at = "2026-09-01T00:00:00.000Z";
        delete find(t.generation_jobs, u(1)).spec.offerType;
      }],
      ["a job made straight through the endpoint with none of the form's boxes needs none of them", (t) => {
        const j = find(t.generation_jobs, u(4));
        j.spec = { assetKind: "video", offerType: "funding" };
      }],
      ["an empty prompt is allowed: the form lets that through on purpose", (t) => { find(t.generation_jobs, u(1)).spec.prompt = ""; }],
      ["the job belongs to a demo partner", (t) => {
        t.partners = [{ id: u(500), org_id: ORG, slug: "demo-partner", name: "Demo", is_demo: true }];
        delete find(t.generation_jobs, u(1)).spec.assetKind;
      }]
    ]
  });
}

// ── job-run ─────────────────────────────────────────────────────────────────
{
  const job = (id, over = {}) => ({
    id, org_id: ORG, partner_id: u(500), status: "queued", attempt: 0, error: null, started_at: null, finished_at: null,
    spec: { assetKind: "static", offerType: "funding" }, idempotency_key: `batch-${id}`, created_at: ago(DAY), updated_at: ago(2 * HOUR), ...over
  });
  FIXTURES.set("job-run", {
    tables: {
      generation_jobs: [
        job(u(1), { status: "succeeded", attempt: 1, started_at: ago(130), finished_at: ago(129) }),
        job(u(2), { status: "failed", attempt: 3, error: "no active provider configured", started_at: ago(130), finished_at: ago(129) }),
        job(u(3), { status: "queued", attempt: 0 }),
        job(u(4), { status: "queued", attempt: 1, error: "provider returned zero assets" }),
        job(u(5), { status: "running", attempt: 1, started_at: ago(10), updated_at: ago(10) })
      ],
      generation_job_assets: [{ id: u(50), org_id: ORG, partner_id: u(500), job_id: u(1), asset_id: u(60) }]
    },
    sample: 5,
    breaks: {
      "a succeeded job stored nothing": [["no asset linked", (t) => { t.generation_job_assets.length = 0; }]],
      "a succeeded job has no finish time or still has an error": [
        ["no finish time", (t) => { find(t.generation_jobs, u(1)).finished_at = null; }],
        ["error still there", (t) => { find(t.generation_jobs, u(1)).error = "old failure"; }]
      ],
      "a failed job has no reason or no finish time": [
        ["no reason", (t) => { find(t.generation_jobs, u(2)).error = " "; }],
        ["no finish time", (t) => { find(t.generation_jobs, u(2)).finished_at = null; }]
      ],
      "a job that ran was never counted as an attempt": [["running with attempt 0", (t) => { find(t.generation_jobs, u(5)).attempt = 0; }]],
      "a retry is waiting past three tries": [["queued with attempt 3", (t) => { find(t.generation_jobs, u(4)).attempt = 3; }]],
      "a job has sat in running for more than an hour": [["running for two hours", (t) => { find(t.generation_jobs, u(5)).started_at = ago(120); }]]
    },
    ignored: [
      ["a job last touched more than 60 days ago", (t) => { find(t.generation_jobs, u(5)).started_at = ago(70 * DAY); find(t.generation_jobs, u(5)).updated_at = ago(70 * DAY); }],
      ["another company's job", (t) => { find(t.generation_jobs, u(1)).org_id = OTHER; t.generation_job_assets.length = 0; }],
      ["the job belongs to a demo partner", (t) => {
        t.partners = [{ id: u(500), org_id: ORG, slug: "demo-partner", name: "Demo", is_demo: true }];
        find(t.generation_jobs, u(2)).error = " ";
      }]
    ]
  });
}

// ── asset-approved / asset-rejected / asset-archived ────────────────────────
{
  const asset = (id, over = {}) => ({
    id, org_id: ORG, partner_id: u(500), kind: "static", format: "1x1", compliance_state: "approved", blocked_reasons: [],
    copy_text: null, archived_at: null, created_at: ago(10 * DAY), updated_at: ago(2 * DAY), ...over
  });
  const partners = () => [{ id: u(500), org_id: ORG, slug: "p", name: "P" }];
  FIXTURES.set("asset-approved", {
    tables: {
      partners: partners(),
      creative_assets: [asset(u(1)), asset(u(2), { kind: "copy", copy_text: "Working capital for owners." })]
    },
    sample: 2,
    breaks: {
      "blocked reasons were left on an approved creative": [
        ["reason left", (t) => { find(t.creative_assets, u(1)).blocked_reasons = [{ code: "x", rule_set: "claims", message: "m" }]; }],
        ["reasons are not even a list", (t) => { find(t.creative_assets, u(1)).blocked_reasons = { code: "x" }; }]
      ],
      "the partner is missing or belongs to another company": [["partner in another company", (t) => { find(t.partners, u(500)).org_id = OTHER; }, 2]],
      "an approved written ad has no words": [["copy asset with no words", (t) => { find(t.creative_assets, u(2)).copy_text = " "; }]],
      "the creative was changed before it was made": [["updated before created", (t) => { find(t.creative_assets, u(1)).updated_at = ago(11 * DAY); }]]
    },
    ignored: [
      ["a blocked creative with reasons is not an approval", (t) => { find(t.creative_assets, u(1)).compliance_state = "blocked"; find(t.creative_assets, u(1)).blocked_reasons = [{ code: "x", message: "m" }]; }],
      ["an old copy asset from before words were saved", (t) => { find(t.creative_assets, u(2)).copy_text = null; find(t.creative_assets, u(2)).created_at = "2026-08-01T00:00:00.000Z"; }]
    ]
  });
  FIXTURES.set("asset-rejected", {
    tables: {
      partners: partners(),
      creative_assets: [
        asset(u(1), { compliance_state: "blocked", updated_at: ago(2 * DAY), blocked_reasons: [{ code: "human_reject", rule_set: "approval", message: "Rejected by reviewer" }] }),
        asset(u(2), { compliance_state: "blocked", updated_at: ago(3 * DAY), blocked_reasons: [
          { code: "guaranteed-approval", rule_set: "claims", message: "Guaranteed approval cannot be advertised." },
          { code: "advance-fee", rule_set: "croa", message: "Charging a fee first is prohibited." }] })
      ]
    },
    sample: 2,
    breaks: {
      "a rejection left the creative not blocked": [
        ["still holds the reject reason but is pending", (t) => { find(t.creative_assets, u(1)).compliance_state = "pending"; }],
        ["still holds the reject reason but is approved", (t) => { find(t.creative_assets, u(1)).compliance_state = "approved"; }]
      ],
      "no reason is listed": [
        ["empty list", (t) => { find(t.creative_assets, u(1)).blocked_reasons = []; }],
        ["not a list", (t) => { find(t.creative_assets, u(1)).blocked_reasons = {}; }]
      ],
      "a reason has no code or no message": [
        ["no message", (t) => { find(t.creative_assets, u(1)).blocked_reasons = [{ code: "human_reject", rule_set: "approval" }]; }],
        ["no code", (t) => { find(t.creative_assets, u(1)).blocked_reasons = [{ rule_set: "approval", message: "m" }]; }],
        ["second reason blank", (t) => { find(t.creative_assets, u(2)).blocked_reasons[1].message = " "; }]
      ],
      "several creatives of one partner were rejected at the same instant": [
        // A Reject that lost its "which creative" condition blocks every creative of the partner in one
        // statement, so they all carry one last-changed time. Two of them are two wrong results.
        ["a second creative rejected at the same instant", (t) => {
          t.creative_assets.push(asset(u(3), { compliance_state: "blocked", updated_at: ago(2 * DAY), blocked_reasons: [{ code: "human_reject", rule_set: "approval", message: "Rejected by reviewer" }] }));
        }, 2, 3]
      ],
      "the partner is missing or belongs to another company": [["partner in another company", (t) => { find(t.partners, u(500)).org_id = OTHER; }, 2]]
    },
    ignored: [
      ["an approved creative is not a rejection", (t) => { find(t.creative_assets, u(1)).compliance_state = "approved"; find(t.creative_assets, u(1)).blocked_reasons = []; }],
      ["two creatives rejected by two separate clicks (different times) are two right results", (t) => {
        const b = find(t.creative_assets, u(2));
        b.blocked_reasons = [{ code: "human_reject", rule_set: "approval", message: "Rejected by reviewer" }];
        b.updated_at = ago(DAY);
      }],
      ["two creatives blocked by the screening engine at the same instant are not people's rejections", (t) => {
        find(t.creative_assets, u(2)).updated_at = ago(2 * DAY);
      }]
    ]
  });
}

// ── brand-approved / brand-sent-back ────────────────────────────────────────
{
  const brand = (id, partner_id, over = {}) => ({
    id, org_id: ORG, partner_id, approval_status: "approved", approved_at: ago(DAY), approved_by: u(900), submitted_at: ago(2 * DAY),
    submitted_by: null, review_note: null, updated_at: ago(DAY), ...over
  });
  const base = () => ({
    partners: [{ id: u(500), org_id: ORG, slug: "a", name: "A" }, { id: u(501), org_id: ORG, slug: "b", name: "B" }, { id: u(502), org_id: ORG, slug: "c", name: "C" }],
    staff: [{ id: u(900), org_id: ORG, role: "owner" }, { id: u(901), org_id: ORG, role: "admin" }]
  });
  FIXTURES.set("brand-approved", {
    tables: {
      ...base(),
      partner_brand: [
        brand(u(1), u(500)),
        brand(u(2), u(501), { approved_by: null, submitted_at: null }),
        // An admin approves too: the approve button is for owner and admin.
        brand(u(3), u(502), { approved_by: u(901) })
      ]
    },
    sample: 3,
    breaks: {
      "no approval time": [["approved with no time", (t) => { find(t.partner_brand, u(1)).approved_at = null; }]],
      "the approver is not an owner or admin of this company": [
        ["approver is now a closer", (t) => { find(t.staff, u(900)).role = "closer"; }],
        ["approver is a staff member of another company", (t) => { find(t.staff, u(900)).org_id = OTHER; }],
        ["approver is not a staff member at all", (t) => { drop(t.staff, u(900)); }]
      ],
      "a brand that went through review has no approver": [["no approver after review", (t) => { find(t.partner_brand, u(1)).approved_by = null; }]],
      "approved before it was sent for review": [["approved a day before it was sent", (t) => { find(t.partner_brand, u(1)).approved_at = ago(3 * DAY); }]],
      "a person approved a brand that was never sent for review": [
        ["approved by an owner but never sent", (t) => { const b = find(t.partner_brand, u(2)); b.approved_by = u(900); }]
      ],
      "a reason note was left on an approved brand": [["old reason still there", (t) => { find(t.partner_brand, u(1)).review_note = "Fix the logo"; }]],
      "the partner is missing or belongs to another company": [["partner in another company", (t) => { find(t.partners, u(500)).org_id = OTHER; }]]
    },
    ignored: [
      ["a draft is not an approval", (t) => { const b = find(t.partner_brand, u(1)); b.approval_status = "draft"; b.approved_at = null; b.review_note = "fix"; }],
      // The demo seed approves its brand with no send-for-review time; demo partners are left out, as in the sibling checks.
      ["the brand belongs to a demo partner", (t) => { find(t.partners, u(500)).is_demo = true; find(t.partner_brand, u(1)).submitted_at = null; }],
      ["a brand approved before the review trail has no sender or approver", (t) => { const b = find(t.partner_brand, u(2)); b.approved_by = null; b.submitted_at = null; }],
      ["an approver who was demoted long after a decision older than 90 days is not a wrong result", (t) => {
        const b = find(t.partner_brand, u(1));
        b.approved_at = ago(100 * DAY);
        b.submitted_at = ago(101 * DAY);
        find(t.staff, u(900)).role = "closer";
      }]
    ]
  });
  FIXTURES.set("brand-sent-back", {
    tables: {
      ...base(),
      partner_brand: [
        brand(u(1), u(500), { approval_status: "draft", approved_at: null, approved_by: null, review_note: "Fix the logo colours." }),
        brand(u(2), u(501), { approval_status: "draft", approved_at: null, approved_by: null, review_note: "Use the full business name." }),
        brand(u(3), u(500), { approval_status: "review", approved_at: null, approved_by: null, review_note: null })
      ]
    },
    sample: 2,
    breaks: {
      "the reason is blank": [
        ["blank reason", (t) => { find(t.partner_brand, u(1)).review_note = "   "; }],
        ["blank reason on a draft that was never sent", (t) => { const b = find(t.partner_brand, u(1)); b.submitted_at = null; b.review_note = "  "; }]
      ],
      "the reason is longer than 2000 characters": [["a 2001 character reason", (t) => { find(t.partner_brand, u(1)).review_note = "x".repeat(2001); }]],
      "a brand was sent back with no reason saved": [
        // The Send it back button's whole point is the required reason. A brand that went back to draft
        // with the time it was sent and no reason at all is that reason lost.
        ["sent back to draft, reason not saved", (t) => { find(t.partner_brand, u(1)).review_note = null; }]
      ],
      "a reason sits on a brand that is approved": [["approved with a reason", (t) => { const b = find(t.partner_brand, u(1)); b.approval_status = "approved"; b.approved_at = ago(DAY); }]],
      "a brand waiting for review still holds an old reason": [["review with a reason", (t) => { find(t.partner_brand, u(3)).review_note = "old complaint"; }, 1, 3]],
      "a brand that is not approved still names an approver": [["draft with an approver", (t) => { find(t.partner_brand, u(1)).approved_by = u(900); }]],
      "the partner is missing or belongs to another company": [["partner in another company", (t) => { find(t.partners, u(500)).org_id = OTHER; }]]
    },
    ignored: [
      ["a draft that was never sent, with no reason and no approver, is not a sent-back brand", (t) => { const b = find(t.partner_brand, u(1)); b.review_note = null; b.submitted_at = null; }]
    ]
  });
}

// ── allowance ───────────────────────────────────────────────────────────────
{
  FIXTURES.set("allowance", {
    tables: {
      partners: [{ id: u(500), org_id: ORG, slug: "a", name: "A" }, { id: u(501), org_id: ORG, slug: "b", name: "B" }],
      partner_module_settings: [
        { id: u(1), org_id: ORG, partner_id: u(500), marketing_suite_enabled: true, ai_token_cap_monthly: 250000 },
        { id: u(2), org_id: ORG, partner_id: u(501), marketing_suite_enabled: false, ai_token_cap_monthly: 80000 }
      ],
      partner_ai_usage: [{ id: u(10), org_id: ORG, partner_id: u(500), purpose: "copy", input_tokens: 120, output_tokens: 40, created_at: ago(DAY) }]
    },
    sample: 2,
    breaks: {
      "the partner is missing or belongs to another company": [["partner in another company", (t) => { find(t.partners, u(500)).org_id = OTHER; }]],
      "the limit is saved as 0 and shown as the default": [["limit 0", (t) => { find(t.partner_module_settings, u(2)).ai_token_cap_monthly = 0; }]],
      "usage is booked to another company": [["usage row in another company", (t) => { find(t.partner_ai_usage, u(10)).org_id = OTHER; }]]
    },
    ignored: []
  });
}

// ───────────────────────────────── the tests ─────────────────────────────────

/**
 * The same rows as another company's: every id gets a new salted twin (links between the rows follow),
 * and every row that belonged to ORG now belongs to OTHER.
 */
function copyForOther(tables, salt) {
  const out = clone(tables);
  const map = new Map();
  const twin = (id) => `a${String(salt).padStart(3, "0")}${id.slice(4)}`;
  for (const rows of Object.values(out)) for (const row of rows) if (typeof row.id === "string") map.set(row.id, twin(row.id));
  for (const rows of Object.values(out)) {
    for (const row of rows) {
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === "string" && map.has(v)) row[k] = map.get(v);
      }
      if (row.spec && typeof row.spec === "object" && map.has(row.spec.scriptId)) row.spec.scriptId = map.get(row.spec.scriptId);
      if (row.org_id === ORG) row.org_id = OTHER;
    }
  }
  return out;
}

function runOn(spec, tables, sql = sqlFor(spec)) {
  const needed = [...new Set([...Object.keys(tables), ...tablesIn(sql)])];
  const standIn = makeStandIn(needed);
  try {
    for (const [table, rows] of Object.entries(tables)) for (const row of rows) standIn.insert(table, row);
    return standIn.run(sql, ORG);
  } finally {
    standIn.close();
  }
}

test("every check has a fixture, and the other way round", () => {
  assert.deepEqual([...FIXTURES.keys()].sort(), FIN_B11_CHECKS.map((c) => c.key).sort());
});

test("every check reads only real tables and real columns", () => {
  for (const spec of FIN_B11_CHECKS) {
    // The stand-in only creates tables that exist in db/schema or db/migrations, with their real
    // columns, and SQLite refuses a column that is not there. Running the healthy set proves both.
    const fx = FIXTURES.get(spec.key);
    assert.doesNotThrow(() => runOn(spec, fx.tables), spec.key);
  }
});

for (const spec of FIN_B11_CHECKS) {
  const fx = FIXTURES.get(spec.key);

  test(`${spec.key}: a healthy set counts ${fx.sample} saved results and none is wrong`, () => {
    assert.deepEqual(runOn(spec, fx.tables), { sample_count: fx.sample, bad_count: 0 });
  });

  test(`${spec.key}: every condition has at least one break, and no break is for an unknown condition`, () => {
    assert.deepEqual(Object.keys(fx.breaks).sort(), spec.bad.map(([name]) => name).sort());
  });

  for (const [condition, cases] of Object.entries(fx.breaks)) {
    for (const [label, mutate, wantBad = 1, wantSample = fx.sample] of cases) {
      test(`${spec.key}: WRONG when ${label}`, () => {
        const tables = clone(fx.tables);
        mutate(tables);
        const out = runOn(spec, tables);
        assert.equal(out.bad_count, wantBad, `${condition}: ${label}`);
        assert.equal(out.sample_count, wantSample, `${condition}: ${label} must not change how many results exist`);
      });
    }
  }

  test(`${spec.key}: the same rows in another company are never counted`, () => {
    // ORG holds the healthy set. OTHER holds the healthy set and every broken variant, side by side.
    const mixed = clone(fx.tables);
    const variants = [fx.tables];
    for (const cases of Object.values(fx.breaks)) {
      for (const [, mutate] of cases) {
        const t = clone(fx.tables);
        mutate(t);
        variants.push(t);
      }
    }
    variants.forEach((variant, i) => {
      for (const [table, rows] of Object.entries(copyForOther(variant, i + 1))) {
        mixed[table] = [...(mixed[table] || []), ...rows];
      }
    });
    assert.deepEqual(runOn(spec, mixed), { sample_count: fx.sample, bad_count: 0 });
  });

  test(`${spec.key}: a check that loses its company condition counts another company's rows`, () => {
    // The check above can only fail if the company condition is what keeps the other company out.
    // Take it out of the text and the other company's rows are counted, so that test would go red.
    const mixed = clone(fx.tables);
    for (const [table, rows] of Object.entries(copyForOther(fx.tables, 1))) mixed[table] = [...(mixed[table] || []), ...rows];
    const sql = sqlFor(spec);
    assert.match(sql, /\$1::uuid/);
    const wide = sql.replace(/(\w+\.org_id) = \$1::uuid/, (_, col) => `${col} IN ($1::uuid, '${OTHER}')`);
    assert.notEqual(wide, sql);
    assert.ok(runOn(spec, mixed, wide).sample_count > fx.sample);
  });

  for (const [label, mutate] of fx.ignored) {
    test(`${spec.key}: not counted when ${label}`, () => {
      const tables = clone(fx.tables);
      mutate(tables);
      const out = runOn(spec, tables);
      assert.equal(out.bad_count, 0, label);
      assert.ok(out.sample_count <= fx.sample, label);
    });
  }

  test(`${spec.key}: dropping any one condition changes the answer for some stand-in row`, () => {
    const variants = [fx.tables];
    for (const cases of Object.values(fx.breaks)) {
      for (const [, mutate] of cases) {
        const t = clone(fx.tables);
        mutate(t);
        variants.push(t);
      }
    }
    const baseline = variants.map((t) => JSON.stringify(runOn(spec, t)));
    const unproven = [];
    for (const [name] of spec.bad) {
      if (spec.bad.length === 1) continue;
      const weaker = sqlFor(spec, { without: [name] });
      const changed = variants.some((t, i) => JSON.stringify(runOn(spec, t, weaker)) !== baseline[i]);
      if (!changed) unproven.push(name);
    }
    assert.deepEqual(unproven, [], `conditions no stand-in row can tell from their absence:\n  ${unproven.join("\n  ")}`);
  });

  test(`${spec.key}: nothing saved yet is green until the first wrong result`, () => {
    const entry = FIN_B11_RESULT_CONTRACTS.find((c) => c.control === spec.control);
    const row = { id: `catalog-display:desks-b.json:x:${spec.control}`, surface: "x", control: spec.control, contract: entry };
    assert.equal(judgeDisplayResult(row, { sample_count: 0, bad_count: 0 }).status, "PASS");
    assert.match(judgeDisplayResult(row, { sample_count: 0, bad_count: 0 }).detail, /no saved results yet/);
    assert.equal(judgeDisplayResult(row, { sample_count: 3, bad_count: 0 }).status, "PASS");
    assert.equal(judgeDisplayResult(row, { sample_count: 3, bad_count: 1 }).status, "FAIL");
    assert.equal(runOn(spec, Object.fromEntries(Object.keys(fx.tables).map((k) => [k, []]))).sample_count, 0);
  });
}

test("every contract is a read-only, company-scoped query with the two counts", () => {
  assert.equal(FIN_B11_RESULT_CONTRACTS.length, FIN_B11_CHECKS.length);
  for (const c of FIN_B11_RESULT_CONTRACTS) {
    assert.equal(c.mode, "query");
    assert.equal(c.emptyAs, "quiet");
    assert.ok(c.requirement.length > 60, c.control);
    assert.match(c.sql, /^\/\* display-result:[a-z-]+ \*\//);
    assert.match(c.sql, /sample_count/);
    assert.match(c.sql, /bad_count/);
    assert.match(c.sql, /\$1::uuid/);
    assert.doesNotMatch(c.sql, /\$2/);
    assert.doesNotMatch(c.sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|SET)\b/);
    assert.doesNotMatch(c.sql, /\b(?:pg_sleep|set_config|nextval|lo_\w+|dblink\w*)\b/i);
  }
  assert.equal(new Set(FIN_B11_RESULT_CONTRACTS.map((c) => c.sql)).size, FIN_B11_RESULT_CONTRACTS.length);
});

test("the batch lists each of its 40 rows once, and every live check is on a row", () => {
  assert.equal(FIN_B11_ROWS.length, 40);
  assert.equal(new Set(FIN_B11_ROWS.map((r) => `${r.surface}\0${r.control}`)).size, 40);
  const keys = FIN_B11_ROWS.filter((r) => r.liveKey).map((r) => r.liveKey).sort();
  assert.deepEqual(keys, FIN_B11_CHECKS.map((c) => c.key).sort());
  for (const row of FIN_B11_ROWS.filter((r) => r.liveKey)) {
    const spec = FIN_B11_CHECKS.find((c) => c.key === row.liveKey);
    assert.equal(spec.control, row.control, row.liveKey);
  }
});
