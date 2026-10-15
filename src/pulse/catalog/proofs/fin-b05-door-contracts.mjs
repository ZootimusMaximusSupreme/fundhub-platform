// Batch 05 of "finish the 853" (customer messages): route rows that now have a
// real-handler test with fake data. A row appears here only when a test calls
// the real api/ handler and judges the named result. The guard test next to this
// file checks every row against the coverage map, every test file, and every
// test title.
//
// This is a practice test (fake data, stand-in database, in-memory provider),
// not a live check. It never reads a real customer's saved result.

export const FIN_B05_GUARD_TEST = "src/pulse/catalog/proofs/fin-b05-door-contracts.test.mjs";

const ENTRIES = [
  {
    sourceFile: "routes-1.json",
    surface: "route:closer-deck",
    control: "POST action=generate_letters {client_id, offer_key, edu?, force_repair?} (build the repair letter pack or funding deliverables pack, save the PDFs, email the client)",
    tests: ["src/pulse/catalog/proofs/fin-b05-door-closer-deck-letters.test.mjs"],
    titles: [
      "closer-deck generate_letters saves the repair letter pack as PDFs on this client's file and emails the client",
      "closer-deck generate_letters on the education route saves the five-document funding pack and sends the deliverables email, not the letters email",
      "closer-deck generate_letters sends nothing when nothing was built: no stored pull, either button",
      "closer-deck generate_letters says why and sends nothing when the document store cannot be opened",
      "closer-deck generate_letters queues no email from a template that has not been approved, and says so",
      "closer-deck generate_letters refuses the funding route, an offer with no letters and an unknown offer; nothing is built, saved or sent",
      "closer-deck generate_letters touches nothing for another company's client, a bad id, a caller with no sign-in, or a sign-in whose company is not a company id",
      "closer-deck generate_letters takes the company from the sign-in, not from anything the request names",
      "closer-deck generate_letters is for closer, sales manager, owner and admin only; every other staff role is refused before anything is built",
      "closer-deck generate_letters pressed twice emails the client once, saves each letter once, and adds no second version of a letter that did not change",
      "closer-deck generate_letters emails every client in the company: the second client is not skipped because the first was already emailed",
      "closer-deck generate_letters files the sworn CFPB and state AG complaints only after a confirmed Round 4 answer, never at Round 1 to 3",
      "closer-deck generate_letters does not email a client who opted out of email, still saves the letters, and is not held up by a text-only opt-out",
      "closer-deck generate_letters answers only POST: any other method is refused before sign-in, a pack, a file or an email",
      "closer-deck generate_letters uses the email template keys the database seed holds, word for word, and the seed holds both",
      "closer-deck generate_letters sends the repair pack on the trial offer and on the descent press, where a funding tier with force_repair still gets the letters",
      "closer-deck generate_letters pressed again after a Round 4 answer adds the two complaints once and repeats no letter",
      "closer-deck generate_letters answers an unexpected failure with a 500 that says what failed, a database outage with a 503, and builds, saves and sends nothing",
    ],
  },
];

export function finB05DoorKey(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  return [file, String(row?.surface || "").trim(), String(row?.control || "").trim()].join("\0");
}

export const FIN_B05_DOOR_CONTRACTS = Object.freeze(ENTRIES.map((entry) => Object.freeze({
  ...entry,
  key: finB05DoorKey(entry.sourceFile, entry),
  proof: Object.freeze({
    depth: "deep",
    evidence: [FIN_B05_GUARD_TEST, ...entry.tests].join(" "),
    asserts: entry.control,
  }),
})));

const BY_KEY = new Map(FIN_B05_DOOR_CONTRACTS.map((entry) => [entry.key, entry.proof]));

export function finB05DoorProof(sourceFile, row) {
  return BY_KEY.get(finB05DoorKey(sourceFile, row)) || null;
}
