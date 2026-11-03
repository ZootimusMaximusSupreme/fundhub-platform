// Company identity, industry-code and actionable business preparation advice.
//
// Suggestions only. Nothing here renames a company or blocks a payment.
//
// The code list is the one written under "NAICS Codes" in
// credentials/notion-scrape/output/nov-datapoint-drop-cca-network--29ac3aa7/FULL.md.
// The risky-industry words are from
// credentials/notion-scrape/output/low-risk-business--b6d65efe/FULL.md.
// The name flags are from
// credentials/notion-scrape/output/using-aged-corps--1e5c3aa7/FULL.md
// ("Low-risk NAICS + neutral name" / "Any hint of real-estate flipping, crypto, trucking, investing").
//
// Owner-set 2026-11-02: prepare three or four separate single-member LLC
// plans alongside credit work, using actual activity, ownership and state.
// Formation, ownership history and operating history are separate facts.
// Source: Alec's Opening LLC, Get EIN and business-checking preparation pages
// under credentials/notion-scrape/output; guidance is not a provider action.
//
// Website + LinkedIn — owner-set 2026-09-27: no scanner, no paid website API.
// They need a website (Alec: banks check online presence). Always recommend a
// LinkedIn business profile because lenders like to see it.

export const APPROVED_NAICS = Object.freeze([
  Object.freeze({ code: "611000", label: "Education" }),
  Object.freeze({ code: "541613", label: "Marketing" }),
  Object.freeze({ code: "541000", label: "Technology" }),
  Object.freeze({ code: "454100", label: "eCommerce" }),
  Object.freeze({ code: "541611", label: "Consulting" }),
  Object.freeze({ code: "531311", label: "Residential" })
]);

/** Automatic decline in the low-risk business notes. */
const RESTRICTED_WORDS = Object.freeze([
  ["ammunition", "ammunition manufacturing"],
  ["bail bond", "bail bonds"],
  ["energy trading", "energy trading"],
  ["loan broker", "loan brokering"],
  ["gambling", "gambling"],
  ["casino", "gambling"],
  ["political campaign", "a political campaign"],
  ["x-rated", "adult entertainment"],
  ["adult entertainment", "adult entertainment"]
]);

/** Stricter underwriting in the same notes, plus the aged-corp name flags. */
const HIGH_RISK_WORDS = Object.freeze([
  ["real estate", "real estate"],
  ["flipping", "real-estate flipping"],
  ["crypto", "crypto"],
  ["trucking", "trucking"],
  ["truck", "trucking"],
  ["investing", "investing"],
  ["investment", "investing"],
  ["agriculture", "agriculture"],
  ["auto sales", "auto sales"],
  ["car dealer", "auto sales"],
  ["courier", "courier services"],
  ["dry cleaner", "dry cleaners"],
  ["contractor", "general contracting"],
  ["nursing home", "nursing homes"],
  ["hotel", "hotels"],
  ["motel", "motels"],
  ["jewelry", "jewelry"],
  ["limousine", "limousine services"],
  ["limo", "limousine services"],
  ["restaurant", "restaurants"],
  ["software", "software"]
]);

/** Existing export names are retained for document and portal consumers. */
export const SHELL_LLC_SUGGESTION_TEXT =
  "Plan three or four separate single-member LLCs for future business preparation. " +
  "Each plan is a separate business with one owner, not several members in one LLC. " +
  "Review the businesses you already have before adding a new plan. Use a basic name " +
  "and describe the business's actual activity. Start with your home state's filing " +
  "requirements, then check the formation and operating states before filing. " +
  "Check current state fees and requirements; there is no fixed filing fee in this plan. " +
  "For each business, save its formation document, EIN confirmation, ownership details, " +
  "website and bank-preparation steps. Keep formation date, ownership history and " +
  "operating history separate. Prepare these steps alongside your personal-credit work, " +
  "with a review around 12 months. Time alone does not establish readiness or approval.";

export const SHELL_LLC_SUGGESTION_WHY =
  "Alec's LLC, EIN and bank-opening material provides the preparation sequence. " +
  "The owner-set plan is three or four separate future businesses with staged reviews. " +
  "A saved company count cannot tell an operating business from a future plan, " +
  "so review each existing business instead of automatically adding more. " +
  "A plan is not a formed company, and a formation date is not proof of operating history.";

/** Standing website copy — owner-set 2026-09-27. No scanner. Shown once per file. */
export const WEBSITE_SUGGESTION_TEXT =
  "You need a website. Set one up with the business's actual services, legal name " +
  "and contact details. Use the same business information on your website and records. " +
  "Save the website link for review.";

export const WEBSITE_SUGGESTION_WHY =
  "Banks check that you exist online. " +
  "Alec's notes say: maintain a basic website tied to the domain — banks often check online presence. " +
  "Fundhub does not scan the site and does not call a paid website API. The rule is simply that they need one.";

/** Standing LinkedIn copy — owner-set 2026-09-27. Shown once per file. */
export const LINKEDIN_SUGGESTION_TEXT =
  "Put the business on LinkedIn as a business profile.";

export const LINKEDIN_SUGGESTION_WHY =
  "Lenders like to see that the person has a business profile on LinkedIn. " +
  "Owner-set 2026-09-27.";

function digits(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d || null;
}

function approvedByCode(code) {
  return APPROVED_NAICS.find((row) => row.code === code) || null;
}

function hits(text, pairs) {
  const hay = ` ${String(text || "").toLowerCase()} `;
  const found = [];
  for (const [needle, label] of pairs) {
    if (hay.includes(needle)) found.push(label);
  }
  return [...new Set(found)];
}

/**
 * auditCompany — one saved company.
 * @returns {object} name and industry suggestions. change is false when nothing is wrong.
 */
export function auditCompany({ name = "", naics = null } = {}) {
  const company = String(name || "").trim();
  const code = digits(naics);
  const approved = code ? approvedByCode(code) : null;
  const nameFlags = [
    ...hits(company, RESTRICTED_WORDS),
    ...hits(company, HIGH_RISK_WORDS)
  ];
  const uniqueFlags = [...new Set(nameFlags)];

  let naicsSuggestion;
  if (!code) {
    naicsSuggestion = {
      change: true,
      from: null,
      status: "missing",
      why: "This company has no industry code. Describe what it actually does, then save the NAICS code that matches that activity. The reference list is not a reason to describe a different business.",
      pick: []
    };
  } else if (!approved) {
    naicsSuggestion = {
      change: false,
      from: code,
      status: "not_on_list",
      why: `${code} is outside the program's reference list. Keep it if it accurately describes the business's actual activity. Review the applicable lender requirements; a different industry code does not change the work the business does.`,
      pick: []
    };
  } else {
    naicsSuggestion = {
      change: false,
      from: code,
      status: "approved",
      label: approved.label,
      why: `${code} ${approved.label} is on the program reference list. Confirm it matches the business's actual activity; being on this list is not an approval.`,
      pick: []
    };
  }

  let nameSuggestion;
  if (!company || uniqueFlags.length === 0) {
    nameSuggestion = {
      change: false,
      from: company || null,
      flags: [],
      why: company ? "The name does not use a flagged word." : "No company name is saved.",
      suggestion: null
    };
  } else {
    const listed = uniqueFlags.join(", ");
    nameSuggestion = {
      change: true,
      from: company,
      flags: uniqueFlags,
      why: `The name mentions ${listed}, which the historical bank notes flag for review. Check requirements for the business's actual activity. A basic name does not change the business's activity or lender eligibility.`,
      suggestion: "Use the registered legal name consistently on existing business records. " +
        "For a new business plan, choose a basic name that fits the actual business. " +
        "Keep the actual activity clear when choosing its industry code and preparing applications."
    };
  }

  return { name: company || null, naics: code, nameSuggestion, naicsSuggestion };
}

/** One preparation recommendation; no automatic new-business count or filings. */
export function shellLlcSuggestion({ companyCount = 0 } = {}) {
  const count = Number.isFinite(companyCount) ? Math.max(0, Math.floor(companyCount)) : 0;
  return {
    change: true,
    status: "standing_rule",
    companyCount: count,
    canTellShellsApart: false,
    why: SHELL_LLC_SUGGESTION_WHY,
    suggestion: SHELL_LLC_SUGGESTION_TEXT
  };
}

/** Standing website rule — always shown once. No scan. No vendor call. */
export function websiteSuggestion() {
  return {
    change: true,
    status: "standing_rule",
    why: WEBSITE_SUGGESTION_WHY,
    suggestion: WEBSITE_SUGGESTION_TEXT
  };
}

/** Standing LinkedIn business-profile rule — always shown once. */
export function linkedInSuggestion() {
  return {
    change: true,
    status: "standing_rule",
    why: LINKEDIN_SUGGESTION_WHY,
    suggestion: LINKEDIN_SUGGESTION_TEXT
  };
}

export function auditCompanies(businesses = [], options = {}) {
  const rows = Array.isArray(businesses) ? businesses : [];
  const companies = rows.map((row) => {
    const entity = row?.entity_data && typeof row.entity_data === "object" ? row.entity_data : {};
    return auditCompany({
      name: row?.name,
      naics: row?.naics ?? entity.naics ?? entity.naics_code ?? null
    });
  });
  return {
    companies,
    businessPreparation: buildBusinessPreparation({ ...options, businesses: rows }),
    shellSuggestion: shellLlcSuggestion({ companyCount: companies.length }),
    websiteSuggestion: websiteSuggestion(),
    linkedInSuggestion: linkedInSuggestion()
  };
}


const BUSINESS_PREPARATION_SOURCES = Object.freeze([
  "credentials/notion-scrape/output/opening-llc--59d3968e/page.md",
  "credentials/notion-scrape/output/get-ein--fda2d58f/page.md",
  "credentials/notion-scrape/output/aged-corps-open-biz-checking--20dc3aa7/page.md",
  "ops/workflows/blueprint-client-simulation-2026-11-02.txt"
]);

const savedText = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const savedState = (value) => {
  const state = savedText(value)?.toUpperCase();
  return state && /^[A-Z]{2}$/.test(state) ? state : null;
};

function preparationRecord(row, planned) {
  const entity = row?.entity_data && typeof row.entity_data === "object" ? row.entity_data : {};
  const name = savedText(row?.name) || savedText(entity.legal_name);
  const activity = savedText(row?.activity) || savedText(entity.activity) || savedText(entity.industry);
  const formationState = savedState(row?.formationState ?? entity.formation_state);
  const operatingState = savedState(row?.operatingState ?? entity.state ?? row?.state);
  const recordState = planned
    ? row?.formationStatus === "reported_formed" ? "reported_formed" : "planned"
    : "existing_record";
  // Never use record creation time, ownership time or entity age as operation history.
  const formationDate = recordState === "planned" ? null
    : savedText(row?.formationDate ?? entity.formation_date ?? entity.started ?? row?.incorporatedDate);
  const ownershipSince = savedText(row?.ownershipSince ?? entity.ownership_since);
  const operatingSince = savedText(row?.operatingSince ?? entity.operating_since);
  const einRecorded = !!savedText(entity.ein_last4);
  const website = savedText(row?.website ?? entity.website);
  const stateWords = formationState ? `your ${formationState} formation requirements` : "your formation state's requirements";
  const step = (key, title, why, instructions, requiredEvidence, state = "not_started") => ({
    key, title, why, instructions, requiredEvidence, state, verification: "not_verified"
  });
  const steps = [
    step("identity", "Confirm this business's details",
      "Each separate business needs its own accurate identity and plan.", [
        "Save its legal or planned basic name, actual activity, formation state and operating state.",
        "For a new single-member LLC plan, record one actual owner. Keep existing ownership as it really is.",
        "Review existing businesses before adding another plan."
      ], ["Business details and actual ownership"], name && activity && formationState && operatingState ? "details_recorded" : "not_started"),
    step("formation", "Prepare or confirm the LLC filing",
      "A planned business is not formed until its state accepts the filing.", [
        `Check ${stateWords}, current fees and any requirements where the business operates.`,
        "Use the state's official filing service or a chosen filing helper; save the accepted document.",
        "Record the actual formation date separately from ownership and operating dates."
      ], ["Accepted formation document", "Actual formation date"], recordState === "reported_formed" ? "reported_complete" : formationDate ? "details_recorded" : "not_started"),
    step("ein", "Prepare the EIN confirmation",
      "The business's EIN confirmation should match its own formation record.", [
        "After formation, use the official IRS EIN application and the actual legal name, state and owner count.",
        "Choose the activity and answers that describe this business, then save its EIN confirmation letter."
      ], ["EIN confirmation letter for this business"], einRecorded ? "details_recorded" : "not_started"),
    step("profile", "Build a clear business profile",
      "Your website and business records should describe the same business.", [
        "Put its actual services, legal name and contact details on its website.",
        "Use consistent business details on relevant public profiles and save the links for review."
      ], ["Business website and profile links"], website ? "details_recorded" : "not_started"),
    step("bank_preparation", "Prepare this business's bank relationship",
      "Account preparation depends on this business's documents, location and available funds.", [
        "Gather its formation record, EIN confirmation, ownership information and signer identification.",
        "Review suitable account requirements and available cash before choosing an opening or deposit date.",
        "Use actual activity and supported expected transactions; record opening dates and evidence when they happen."
      ], ["Business document checklist", "Account-opening or deposit evidence when available"])
  ];
  return {
    businessId: planned ? savedText(row?.businessId) : savedText(row?.id),
    planId: planned ? savedText(row?.id) : null,
    name, activity, recordState, formationState, operatingState,
    formationDate, ownershipSince, operatingSince,
    nextActionKey: steps.find((item) => item.state === "not_started")?.key || null,
    steps
  };
}

/** Pure advice: saved plans stay separate from canonical existing businesses. */
export function buildBusinessPreparation({ businesses = [], plans = [], targetBusinessCount = 4 } = {}) {
  return {
    targetBusinessCount: targetBusinessCount === 3 ? 3 : 4,
    targetOptions: [3, 4],
    reviewHorizonMonths: 12,
    formationMode: "single_member_llc",
    existingBusinesses: (Array.isArray(businesses) ? businesses : []).map((row) => preparationRecord(row, false)),
    plans: (Array.isArray(plans) ? plans : []).map((row) => preparationRecord(row, true)),
    sources: [...BUSINESS_PREPARATION_SOURCES]
  };
}
