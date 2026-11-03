/* Source-backed lessons for the real Blueprint portal. No provider calls or
 * customer writes happen here. Completion is recorded by the scoped plan API;
 * a lesson never turns a client report into independently verified evidence. */
export const PREPARATION_STEP_KEYS = Object.freeze([
  "credit_review", "budget", "authorized_user", "secured_credit", "business_profile",
  "business_website", "business_listings", "local_banking", "chexsystems", "bank_opening",
  "bank_deposit", "business_credit", "merchant_tools", "employment", "calendar", "formation", "ein"
]);

const SOURCES = Object.freeze({
  credit: "https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-and-keep-a-good-credit-score-en-318/",
  authorizedUser: "https://www.consumerfinance.gov/ask-cfpb/how-do-i-remove-an-authorized-user-from-my-credit-card-account-en-86/",
  checking: "https://www.consumerfinance.gov/ask-cfpb/why-was-i-denied-a-checking-account-en-1113/",
  stateOffice: "https://www.sba.gov/counseling/launch-your-business/state-registration-lookup/",
  ein: "https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number",
  employment: "https://www.irs.gov/businesses/small-businesses-self-employed/paying-yourself",
  googleProfile: "https://support.google.com/business/answer/2911778",
  googleRanking: "https://support.google.com/business/answer/7091",
  yellowPages: "https://www.yellowpages.com/",
  creditUnions: "https://mapping.ncua.gov/",
  merchant: "https://docs.whop.com/",
  alecFormation: "alec:opening-llc--59d3968e",
  alecEin: "alec:get-ein--fda2d58f",
  alecWebsite: "alec:get-biz-website--94d03c1f",
  alecBanking: "alec:details-aged-corp--1b8c3aa7",
  alecSecured: "alec:secured-cards--3acec005"
});

const text = (v, limit = 600) => typeof v === "string" ? v.trim().slice(0, limit) : "";
const link = (label, url) => ({ label, url });

export function websitePrompt(business = {}) {
  return [
    `Write a clear website for ${text(business.name || business.legalName, 120) || "[business name]"}.`,
    `Actual activity: ${text(business.activity || business.industry) || "[real product or service]"}.`,
    `Location: ${text(business.formationState || business.state, 80) || "[business location]"}.`,
    "Include a home page, services, about and contact information. Explain who we serve and what we actually sell.",
    "Keep the legal name, public name, address, phone and website consistent with the records I provide.",
    "Use placeholders for missing facts. Ask before adding credentials, testimonials, years in business, revenue or results.",
    "Give me a short list of missing details to check before publishing."
  ].join("\n");
}

export function formationDestination(context = {}) {
  const state = text(context.business?.formationState || context.business?.state || context.homeState, 80);
  // Arizona LLCs are filed with the Corporation Commission, not its SOS.
  if (/^(AZ|Arizona)$/i.test(state)) return link("Open Arizona’s LLC filing guide", "https://azcc.gov/corporations");
  return link(state ? `Find the ${state} filing office` : "Find your state filing office", SOURCES.stateOffice);
}

function lesson(key, title, track, why, steps, proof, nextReview, options = {}) {
  return { key, title, track, why, steps, links: [], proof, nextReview,
    optional: false, applicability: "ready", sourceRefs: [], ...options };
}

/**
 * Always returns the full requested curriculum so optional or data-dependent
 * work is visible. Applicability is explicit; missing facts never become an
 * instruction to remove an account or apply for more credit.
 */
export function preparationGuidance(context = {}) {
  const business = context.business || {};
  const credit = context.creditContext || {};
  const au = credit.authorizedUserReviewRequired === true;
  const secured = credit.securedCreditReviewRequired === true;
  const formed = business.formationStatus === "reported_formed" || Boolean(business.formationDate);
  const location = text(context.postalCode, 10) || "your ZIP code";
  const name = text(business.name, 120) || "this business";
  const guides = [
    lesson("credit_review", "Review your credit priorities", "credit",
      "Your next actions should come from the accounts and dates on your actual file.",
      ["Open your latest available credit report and check its date.",
       "Match the account names, ownership, balances and limits to your records.",
       "Work through the account-specific priorities in your roadmap; tell the Fundhub team about anything unclear."],
      "The saved report and your notes about any incorrect or unclear account.",
      "Review when a new report arrives or a material account detail changes.",
      { links: [link("Read the CFPB credit guide", SOURCES.credit)], sourceRefs: [SOURCES.credit] }),
    lesson("budget", "Set a workable cash plan", "credit",
      "Paydowns, deposits and business costs need to share the cash you can actually use.",
      ["Record cash available after essential bills and your chosen buffer.",
       "List each planned paydown, bank deposit and filing cost separately.",
       "Check the combined amount before committing money, then save the dates you can support."],
      "Your stated cash budget and planned commitments. A saved plan is not a payment receipt.",
      "Review when income, bills, balances or planned commitments change.",
      { links: [link("Review credit-building basics", SOURCES.credit)], sourceRefs: [SOURCES.credit] }),
    lesson("authorized_user", "Review an authorized-user account", "credit",
      "An authorized-user account and a joint account have different ownership. A change should fit your actual file.",
      ["Confirm which account your roadmap flags and whether you are an authorized user or joint owner.",
       "If removal is the agreed step, contact the card issuer through its official app or customer-service number and ask about its removal process.",
       "Save the issuer’s confirmation and check the next report. If the account is misreported, document the specific error for review."],
      "Issuer confirmation plus later reporting evidence; a phone call alone does not prove a bureau update.",
      "After the issuer’s stated reporting period or when your next report is available.",
      { optional: !au, applicability: au ? "ready" : "review_needed", links: [link("Understand authorized-user removal", SOURCES.authorizedUser)], sourceRefs: [SOURCES.authorizedUser] }),
    lesson("secured_credit", "Review whether secured credit fits", "credit",
      "A secured card may help a thin file, but an extra application and deposit should have a clear purpose.",
      ["Confirm your roadmap calls for another primary account before applying.",
       "Compare the issuer’s current deposit, fees, bureau reporting and credit-check terms.",
       "Fit the deposit into your cash plan. Record the actual opening and reporting dates only if you open the account."],
      "The chosen product’s current terms, account-opening confirmation and later report.",
      "Before applying, then after the issuer’s stated reporting cycle.",
      { optional: !secured, applicability: secured ? "ready" : "review_needed", links: [link("Review credit-building options", SOURCES.credit)], sourceRefs: [SOURCES.credit, SOURCES.alecSecured] }),
    lesson("business_profile", "Make your business records consistent", "business",
      "Each business needs its own clear identity and accurate activity description.",
      [`Confirm ${name}’s actual ownership, formation state and product or service.`,
       "Compare its legal name, public name, address, phone and industry across its documents and public records.",
       "Resolve mismatches using the correct filing or provider process. Keep separate records for each of the three or four businesses in your plan."],
      "Current business records and any accepted correction receipts.",
      "After a correction is accepted and whenever business details change.",
      { links: [formationDestination(context)], sourceRefs: [SOURCES.alecFormation, SOURCES.stateOffice] }),
    lesson("business_website", "Build a clear business website", "business",
      "A useful website explains the real business and gives customers consistent contact details.",
      ["Copy the website prompt and fill in your actual services, audience and contact details.",
       "Review the draft’s home, services, about and contact pages.",
       "Check every claim, publish when accurate, and save the live website address with this business."],
      "A working public URL whose business identity and claims match the saved records.",
      "After publishing and whenever services or contact details change.",
      { links: [link("Check Google’s business information guidance", SOURCES.googleRanking)], sourceRefs: [SOURCES.alecWebsite, SOURCES.googleRanking], prompt: websitePrompt(business) }),
    lesson("business_listings", "Make eligible business listings accurate", "business",
      "Consistent listings help customers find and understand the actual business.",
      ["Search your business name and location to find existing Google and Yellow Pages listings.",
       "Where eligible, claim the correct profile and complete the provider’s ownership verification; do not create duplicates.",
       "Match the name, contact details, hours and actual business category. Keep the website useful and current; a first-page ranking is not guaranteed."],
      "The public listing URLs and provider verification or correction receipts.",
      "After verification or a details change; review search visibility separately from funding readiness.",
      { links: [link("Add or claim a Google Business Profile", SOURCES.googleProfile), link("Improve local information on Google", SOURCES.googleRanking), link("Find your Yellow Pages listing", SOURCES.yellowPages)], sourceRefs: [SOURCES.googleProfile, SOURCES.googleRanking, SOURCES.yellowPages] }),
    lesson("local_banking", "Find local credit-union candidates", "banking",
      "Local fit includes where a branch is, whether you can join, and whether the account suits this business.",
      [`Confirm ${location} and review up to five distinct institutions with local branch evidence.`,
       "Open each institution’s official information and confirm membership eligibility, business services and account availability.",
       "Compare current fees, minimums and deposits against your available cash. Save the shortlist and the reason each candidate fits."],
      "Source-dated branch locations and current membership, product and deposit terms for each shortlisted institution.",
      "Before choosing an account and when your address or eligibility changes.",
      { links: [link("Open the official NCUA locator", SOURCES.creditUnions)], sourceRefs: [SOURCES.creditUnions, SOURCES.alecBanking] }),
    lesson("chexsystems", "Review account-opening history", "banking",
      "A checking-account report can affect account opening independently of a personal credit score.",
      ["If you were denied, read the bank’s notice and identify the reporting company it used, such as ChexSystems or Early Warning Services.",
       "Request the relevant report through the reporting company’s official process and check the entries against your records.",
       "For an error, send a specific dispute with supporting evidence. Save the confirmation and response; discuss any legitimate balance or account issue with the bank."],
      "The report, specific disputed facts, submission confirmation and reporting company or bank response.",
      "On the response date given by the reporting company and before the next account application.",
      { links: [link("Read the CFPB account-opening guide", SOURCES.checking)], sourceRefs: [SOURCES.checking] }),
    lesson("bank_opening", "Plan the first bank relationships", "banking",
      "Banking preparation can begin during credit optimization when documents, eligibility and cash support it.",
      ["List current relationships first, then review an initial one-to-three suitable account opportunities with the Fundhub team.",
       "Gather formation and EIN documents, ownership and signer identification, and supported business details.",
       "Confirm the actual account requirements and pace before applying. Save each accepted opening date against the correct business."],
      "Account-opening confirmation and the business’s current account details; a planned date is not an opened account.",
      "After opening and at the next relationship review date.",
      { links: [link("Find a credit union", SOURCES.creditUnions), link("Review account-opening issues", SOURCES.checking)], sourceRefs: [SOURCES.alecBanking, SOURCES.checking] }),
    lesson("bank_deposit", "Plan and track a business deposit", "banking",
      "The money available and the actual deposit date matter to a workable relationship plan.",
      ["Confirm the current product’s minimum, fees and any relevant relationship requirement directly with the institution.",
       "Reserve the deposit in your shared cash plan, without reusing money committed elsewhere.",
       "If you deposit, record the actual amount and cleared date with the correct business. Set a review using that product’s confirmed requirements."],
      "A bank receipt or statement showing the actual deposit and date. A target or elapsed time is not verification.",
      "After clearance and on the saved review date; reassess if the balance or product terms change.",
      { sourceRefs: [SOURCES.alecBanking] }),
    lesson("business_credit", "Consider optional business-credit tools", "business",
      "A useful business-credit account should support actual operating needs and fit your budget.",
      ["Identify a real business purchase or operating need before choosing an account, including any fuel or fleet-card use.",
       "Ask the Fundhub team to review the specific program, reporting, fees, payment terms and any guarantee requirement.",
       "Use a current reviewed program when suitable. David’s proposed gas-card material is still needed before this plan can recommend his specific program."],
      "Reviewed current program terms, an actual business use case and later account/reporting records.",
      "When the specific program has been reviewed and after its first billing or reporting cycle.",
      { optional: true, applicability: "review_needed", sourceRefs: ["owner:David-gas-card-material-pending"] }),
    lesson("merchant_tools", "Review payment processing and customer financing", "revenue",
      "An operating business may need a suitable way to accept payments or offer eligible customers financing.",
      ["Describe what you sell, the sales channel, actual transaction history and what customers need.",
       "Ask the Fundhub team to confirm the appropriate Whop, Commas or Clarity route and any available partnership referral.",
       "Review current product eligibility, fees, settlement and refund terms before applying. Save the provider’s actual decision and onboarding result."],
      "A confirmed referral destination and provider approval/onboarding receipt. Fundhub’s own checkout does not prove your merchant account is approved.",
      "When a referral is available, after the provider’s decision, and when your selling model changes.",
      { optional: true, applicability: "review_needed", links: [link("Read Whop’s payment platform overview", SOURCES.merchant)], sourceRefs: [SOURCES.merchant, "owner:merchant-partnership-destination-to-confirm"] }),
    lesson("employment", "Prepare accurate owner and income records", "business",
      "Employment, business ownership and the way you are paid need to match your actual setup.",
      ["Record your real employer or business ownership and how you currently receive income.",
       "Gather the records the lender requests, such as actual payroll, tax or business-income documents.",
       "Use the application’s correct category for your circumstances. A later corporate tax election is a separate decision and does not rewrite earlier employment or income history."],
      "Actual payroll, tax, ownership or income records appropriate to the application.",
      "Before an application and whenever your employment or pay structure changes.",
      { links: [link("Read IRS guidance on paying yourself", SOURCES.employment)], sourceRefs: [SOURCES.employment] }),
    lesson("calendar", "Put your next review on your calendar", "planning",
      "A visible reminder helps you return when a document, report or relationship is ready to review.",
      ["Choose the review date for the actual step and check which result you expect to have by then.",
       "Use Add to Google Calendar, or import the calendar file into your calendar app, and save the event and reminder.",
       "Update the saved event when the plan changes. Adding an event does not connect a bank, order a report or verify a task."],
      "The saved calendar event and your selected reminder; the plan’s saved target date remains the source for the review.",
      "On the event date or whenever the underlying step moves.",
      { sourceRefs: ["owner:calendar-reminders"] }),
    lesson("formation", formed ? "Review this LLC’s formation records" : "Form this single-member LLC", "business",
      "Each business needs its own correct formation record and timeline.",
      ["Start with a basic name and the state appropriate to your actual business. Check name availability and the state’s current filing requirements.",
       formed ? "Match the saved formation and ownership details to the existing state records; use the state’s correction process for a mismatch." : "Follow the state’s LLC filing instructions for one member when you are the only owner, and review optional service costs before accepting them.",
       "After acceptance, save the actual formation date and document. Keep three or four separate business plans moving through their own milestones over roughly 12 months."],
      "An accepted formation document and actual dates. Preparing or aging an entity does not establish operating history or funding approval.",
      "After state acceptance and at the next saved business milestone.",
      { links: [formationDestination(context)], sourceRefs: [SOURCES.alecFormation, SOURCES.stateOffice] }),
    lesson("ein", "Get and save this business’s EIN confirmation", "business",
      "The IRS record should match the business that was actually formed.",
      ["Complete state formation first, then open the official IRS EIN guide and application.",
       "Choose LLC and the actual member count, state and responsible-party information. Answer industry and other questions for this business’s real circumstances.",
       "Download the IRS confirmation letter and add it to this business’s documents. The IRS online application allows one EIN per responsible party per day."],
      "The IRS confirmation letter for the correct formed entity; starting an application is not an issued EIN.",
      "After the IRS issues the EIN and when the saved business record needs correction.",
      { applicability: formed ? "ready" : "review_needed", links: [link("Open the official IRS EIN guide", SOURCES.ein)], sourceRefs: [SOURCES.ein, SOURCES.alecEin] })
  ];
  return guides;
}

export default preparationGuidance;
