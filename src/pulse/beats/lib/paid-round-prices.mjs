// The self-serve dispute round's public name and its price list. ONE COPY (2026-10-20).
//
// SERVICE_KEY and roundPriceList used to live in src/paid-services/round.mjs. They moved here unchanged so the
// hourly beat client-progress quotes the round exactly as GET /api/read/client-progress and GET /api/paid-services
// do (a beat may import only from src/pulse/beats/lib). round.mjs imports them back and re-exports them. Pure.

import { priceDisputeRound } from "./waypoint-pricing.mjs";

/** The public name of the buyable round: the one service api/paid-services.mjs accepts. */
export const SERVICE_KEY = "paid_round";

/** The price list a screen renders before anything is bought.
 *
 *  The `key` and `priceCents` are the facts. `label` is a short receipt line
 *  and is here because the orchestrator's contract for
 *  /api/read/client-progress carries one — it names the add-on, it is not
 *  marketing copy, and the sentences around the button still live in the front
 *  end. Owner-set branding applies to it like everything else client-facing.
 *
 *  Each add-on's price is derived by SUBTRACTION from the priced round rather
 *  than restated as a constant, so this list cannot drift away from what a
 *  client is actually charged. */
export function roundPriceList() {
  const base = priceDisputeRound({});
  const withCreditor = priceDisputeRound({ creditorLetter: true });
  const withEscalation = priceDisputeRound({ escalationFilings: true });
  return [
    {
      key: "base",
      label: "Three bureaus",
      priceCents: base.totalCents,
      required: true
    },
    {
      key: "creditor",
      label: "Creditor letter",
      priceCents: withCreditor.totalCents - base.totalCents,
      required: false
    },
    {
      key: "cfpb_and_ag",
      label: "CFPB and state attorney general",
      priceCents: withEscalation.totalCents - base.totalCents,
      required: false
    }
  ];
}
