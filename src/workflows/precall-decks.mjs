const HOUR = 3_600_000;
// Canonical approved lesson content, channels and booked-call timing, shared by the durable planner.
export const DECK_SLOTS = Object.freeze([
  { funding: null, blueprint: "bank-said-no", channel: "email" },
  { funding: "the-call", blueprint: "the-call", channel: "email" },
  { funding: "pre-underwriting", blueprint: "thirteen-points", channel: "email" },
  { funding: "soft-pull", blueprint: "soft-pull", channel: "sms" },
  { funding: null, blueprint: "card-paydown", channel: "email" },
  { funding: "funding-sequence", blueprint: "credit-optimization", channel: "email" },
  { funding: "who-we-are", blueprint: "who-we-are", channel: "email" },
  { funding: "apply-yourself", blueprint: "blueprint-value", channel: "email" },
  { funding: "your-data-is-safe", blueprint: "your-data-is-safe", channel: "email" },
  { funding: null, blueprint: "business-one-two", channel: "email" },
  { funding: "money-on-the-table", blueprint: "credit-partner", channel: "email" },
  { funding: "cost-of-waiting", blueprint: "cost-of-waiting", channel: "sms" },
  { funding: "the-maximum", blueprint: "the-maximum", channel: "email" },
  { funding: null, blueprint: "blueprint-12-months", channel: "email" },
  { funding: "tried-before", blueprint: "tried-before", channel: "email" },
  { funding: "the-money-talk", blueprint: "the-money-talk", channel: "email" },
  { funding: "after-you-say-yes", blueprint: "blueprint-in-action", channel: "email" }
]);

export const DECK_TITLES = Object.freeze({
  "the-call": "Your file picks the path before any price",
  "soft-pull": "A soft pull does not move your score",
  "pre-underwriting": "Why a bank can deny good credit",
  "bank-said-no": "The reason a bank said no is on your report",
  "funding-sequence": "The order of applications changes the result",
  "thirteen-points": "The 13 points that shape funding readiness",
  "who-we-are": "How Fundhub works with your file",
  "apply-yourself": "What the next bank sees after an application",
  "card-paydown": "Which card to pay first",
  "your-data-is-safe": "How Fundhub handles your information",
  "money-on-the-table": "What a strong score can leave on the table",
  "credit-optimization": "Why the letters go out in order",
  "cost-of-waiting": "What changes while you wait",
  "after-you-say-yes": "What happens after you sign",
  "blueprint-value": "A roadmap built from your own file",
  "the-maximum": "How the maximum starts with your file",
  "business-one-two": "Why each business is judged on its own",
  "blueprint-12-months": "How the Blueprint guides your next 12 months",
  "tried-before": "Why past attempts did not fund",
  "the-money-talk": "The money talk happens on the call",
  "credit-partner": "How a credit partner can help",
  "blueprint-in-action": "Your Blueprint dashboard, start to finish"
});

export const DECK_INTROS = Object.freeze({
  "the-call": "Your file comes first on the call. The path and price follow what it actually shows.",
  "soft-pull": "A soft file review lets us see where you stand before anyone applies at a bank.",
  "pre-underwriting": "A strong score can still meet a bank rule your file does not pass yet.",
  "bank-said-no": "A decline gives us a starting point: read the file, find the reason, then put the work in order.",
  "funding-sequence": "Bank choice and application order matter because each lender reads the file it receives.",
  "thirteen-points": "The Blueprint puts the 13 funding-readiness checks in an order you can act on.",
  "who-we-are": "See the people, records and written steps behind the Fundhub process.",
  "apply-yourself": "Before sending another application, see what the next lender may read on your file.",
  "card-paydown": "Each card has its own balance target and statement date. The order changes what reports next.",
  "your-data-is-safe": "See what information Fundhub uses, where it appears and what you approve before paying.",
  "money-on-the-table": "A sample file shows how card balances can change the funding path even with a strong score.",
  "credit-optimization": "Credit work moves through documented rounds, bureau replies and a visible record in your portal.",
  "cost-of-waiting": "Waiting has a cost only if it delays a real goal. Put your own timing against the work ahead.",
  "after-you-say-yes": "The agreement and portal show what starts after you sign, who acts and what approved means.",
  "blueprint-value": "The Blueprint starts with your file and turns it into an ordered 12-month plan.",
  "the-maximum": "Your first bank offer is one answer. Your file and application order shape what comes next.",
  "business-one-two": "Each business has its own setup and bank review, even when the owner is the same.",
  "blueprint-12-months": "See the first Blueprint steps and how the plan changes as your file changes.",
  "tried-before": "If a past funding attempt failed, look at what was sent and what it left on the file.",
  "the-money-talk": "If cost is the concern, bring it to the call. We will read the real terms with your file open.",
  "credit-partner": "A credit partner has a separate file, consent and obligation. See how that path works.",
  "blueprint-in-action": "Open a sample Blueprint dashboard and follow the first steps from the file review forward."
});

export function deckTime(startTime, index) {
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs) || index < 0 || index >= DECK_SLOTS.length) return null;
  const local = new Date(startMs - 7 * HOUR);
  const day = index < 6 ? 3 : index < 12 ? 2 : 1;
  const count = day === 1 ? 5 : 6;
  const callHour = local.getUTCHours() + local.getUTCMinutes() / 60;
  const hours = day === 3 ? [9, 10, 11, 13, 15, 16]
    : [9, 10, 11, 12, 13, 14, 15, 16]
      .filter((hour) => Math.abs(hour - callHour) >= 1);
  const picks = count === 6
    ? (hours.length === 8 ? [0, 1, 2, 4, 5, 7]
      : hours.length === 7 ? [0, 1, 2, 3, 5, 6] : [0, 1, 2, 3, 4, 5])
    : [0, 1, Math.floor(hours.length / 2), hours.length - 2, hours.length - 1];
  const slot = index < 6 ? index : index < 12 ? index - 6 : index - 12;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(),
    local.getUTCDate() - day, hours[picks[slot]] + 7));
}
