/* Tests for the client drawer in public/app/pipeline.html — the survey block
 * and the ad-routing lines under "How they got here".
 *
 * Both come from the live walk of 2026-09-03. The drawer painted all four
 * branch questions to everybody, so a client who was never asked about
 * personal income read "—" in the same way a client whose answer went missing
 * did (F8); and gate / entry / primary / secondary never appeared here at all,
 * though the closer screen has read them off /api/read/ad-attribution since
 * the registry landed (F9).
 *
 * The logic is lifted out of the page by the FH-DRAWER markers and run in a
 * sandbox, the same way pipeline-screen.test.mjs tests the summary bar.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/pipeline.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

const BEGIN = "/* FH-DRAWER-BEGIN */";
const END = "/* FH-DRAWER-END */";

function loadDrawer() {
  const a = HTML.indexOf(BEGIN);
  const b = HTML.indexOf(END);
  assert.ok(a !== -1 && b > a, "the FH-DRAWER markers are gone from pipeline.html");
  const sandbox = { window: {}, JSON, String, Array, Object };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-DRAWER" });
  return sandbox.window.FHPipelineDrawer;
}

/* Sim Five-Academy's real custom_fields, read off production on 2026-09-03.
   Note what is NOT here: cf_svy_revenue_verifiable never arrives, and
   cf_svy_business_revenue carries the answer to "Can You Verify Revenue?".
   That is a ClickFunnels attribute mapping the owner has to correct in CF —
   the drawer's job is to stop showing questions this client was never asked. */
const SIM_FIVE = {
  cf_svy_funding_target_amount: 207883,
  cf_svy_funding_target_amount_label: "$200k - $400k",
  cf_svy_planned_use: 207888,
  cf_svy_planned_use_label: "Growth (marketing, inventory, hiring)",
  cf_svy_money_change_now: [207897],
  cf_svy_money_change_now_labels: '["Grow faster (more customers / more reach)"]',
  cf_svy_self_reported_fico: 207909,
  cf_svy_self_reported_fico_label: "750+",
  cf_svy_has_business: 207918,
  cf_svy_has_business_label: "Yes, 5+ years",
  cf_svy_business_revenue: 208124,
  cf_svy_business_revenue_label: "Yes, both",
  cf_svy_available_capital: 207975,
  cf_svy_available_capital_label: "$100k+"
};

/* Sim Three-Trial, the personal-funding branch, same source. Both of its
   branch questions map correctly in ClickFunnels today. */
const SIM_THREE = {
  cf_svy_funding_target_amount_label: "Less than $50k",
  cf_svy_planned_use_label: "Covering a shortfall right now",
  cf_svy_money_change_now_labels: '["Stability (cover bills / buffer slow weeks)"]',
  cf_svy_self_reported_fico_label: "580-649",
  cf_svy_has_business_label: "No, personal funding only",
  cf_svy_annual_income_range_label: "$50k-$99k",
  cf_svy_income_verifiable_label: "Yes, both",
  cf_svy_available_capital_label: "Less than $1k"
};

const labels = (rows) => rows.map((r) => r[0]);
const byLabel = (rows, label) => (rows.find((r) => r[0] === label) || [])[1];

describe("pipeline.html drawer — survey rows follow the survey's branch", () => {

  test("a business client is not asked about personal income, so those rows are gone", () => {
    const rows = loadDrawer().surveyRowsFor(SIM_FIVE);
    assert.ok(labels(rows).includes("Business revenue"));
    assert.ok(labels(rows).includes("Can verify revenue"));
    assert.ok(!labels(rows).includes("Personal income"));
    assert.ok(!labels(rows).includes("Can verify income"));
  });

  test("a personal-funding client gets the income pair and neither business row", () => {
    const rows = loadDrawer().surveyRowsFor(SIM_THREE);
    assert.ok(labels(rows).includes("Personal income"));
    assert.ok(labels(rows).includes("Can verify income"));
    assert.ok(!labels(rows).includes("Business revenue"));
    assert.ok(!labels(rows).includes("Can verify revenue"));
    assert.equal(byLabel(rows, "Personal income"), "$50k-$99k");
    assert.equal(byLabel(rows, "Can verify income"), "Yes, both");
  });

  test("every row shows the words, never a ClickFunnels option id", () => {
    for (const cf of [SIM_FIVE, SIM_THREE]) {
      for (const [label, value] of loadDrawer().surveyRowsFor(cf)) {
        if (value == null) continue;
        assert.ok(!/^\d{5,}$/.test(String(value).trim()), `${label} shows an option id: ${value}`);
      }
    }
  });

  test("a multi-select shows every choice, joined", () => {
    const rows = loadDrawer().surveyRowsFor({
      cf_svy_money_change_now: [207897, 207899],
      cf_svy_money_change_now_labels: '["Grow faster (more customers / more reach)","Stability (cover bills / buffer slow weeks)"]'
    });
    assert.equal(
      byLabel(rows, "What money changes"),
      "Grow faster (more customers / more reach), Stability (cover bills / buffer slow weeks)"
    );
  });

  test("with no branch answer it shows the side that carries data, and neither when both are empty", () => {
    const d = loadDrawer();
    assert.equal(d.surveyBranch({ cf_svy_business_revenue_label: "$1M+" }), "business");
    assert.equal(d.surveyBranch({ cf_svy_income_verifiable_label: "Yes, both" }), "personal");
    assert.equal(d.surveyBranch({}), null);
    const bare = labels(d.surveyRowsFor({}));
    assert.ok(!bare.includes("Business revenue") && !bare.includes("Personal income"));
    // The questions every client is asked still show, blank, so a missing
    // answer to one of them stays visible as a missing answer.
    assert.ok(bare.includes("Target amount") && bare.includes("Available capital"));
  });
});


describe("pipeline.html drawer — real credit controls Survey/Credit priority", () => {
  test("survey stays first with no pull or only client-reported score", () => {
    const d = loadDrawer();
    assert.equal(d.creditIsComplete({}), false);
    assert.equal(d.creditIsComplete({ experian: 771, equifax: 778, transunion: 766 }), false);
  });
  test("a sample and an incomplete real report do not promote credit", () => {
    const d = loadDrawer();
    assert.equal(d.creditIsComplete({ sample: true, asOf: "2026-10-30", experian: 771, equifax: 778, transunion: 766 }), false);
    assert.equal(d.creditIsComplete({ asOf: "2026-10-30", experian: 771, equifax: 778 }), false);
  });
  test("all three measured scores with a genuine pull date promote Credit", () => {
    const d = loadDrawer();
    assert.equal(d.creditIsComplete({ sample: false, asOf: "2026-10-30", experian: 771, equifax: 778, transunion: 766 }), true);
  });
});

describe("pipeline.html drawer — the four ad-routing lines", () => {

  test("it says the same four things the closer screen says", () => {
    const rows = loadDrawer().adRoutingRows({
      attribution: { ad_id: "82" },
      registry: { known: true },
      resolved: { gate: "720", entry: "direct", primary_offer: "funding_dfy", secondary_offers: [] }
    });
    assert.deepEqual(rows, [
      ["Gate", "720+"],
      ["Entry", "Direct · sell what they were promised"],
      ["Primary offer", "Funding, done-for-you"],
      ["Secondary offers", "None"]
    ]);
  });

  test("a sorting ad reads as every road open, and names the primary to lead with", () => {
    const rows = loadDrawer().adRoutingRows({
      attribution: { ad_id: "43" },
      registry: { known: true },
      resolved: { gate: "none", entry: "sorting", primary_offer: "funding_dfy", secondary_offers: "all" }
    });
    assert.equal(byLabel(rows, "Gate"), "No FICO gate");
    assert.equal(byLabel(rows, "Entry"), "Sorting · every road is open");
    assert.equal(byLabel(rows, "Primary offer"), "Funding, done-for-you · lead with it");
    assert.equal(byLabel(rows, "Secondary offers"), "All");
  });

  test("an unknown ad and a missing ad each say so rather than reading like a real answer", () => {
    const d = loadDrawer();
    const unknown = d.adRoutingRows({
      attribution: { ad_id: "999" },
      registry: { known: false },
      resolved: { gate: "none", entry: "sorting", primary_offer: "none", secondary_offers: "all" }
    });
    assert.match(byLabel(unknown, "Entry"), /ad 999 not in the registry/);
    const none = d.adRoutingRows({
      attribution: null,
      registry: { known: false },
      resolved: { gate: "none", entry: "sorting", primary_offer: "none", secondary_offers: "all" }
    });
    assert.match(byLabel(none, "Entry"), /no ad on file/);
  });

  test("nothing to show is nothing painted — never a guessed default", () => {
    const d = loadDrawer();
    assert.deepEqual(d.adRoutingRows(null), []);
    assert.deepEqual(d.adRoutingRows({}), []);
  });
});
