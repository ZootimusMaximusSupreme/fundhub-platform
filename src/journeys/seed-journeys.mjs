/* The six journey trees, server-side.
 *
 * THE KEY LIST HERE DOES NOT MATCH docs/journeys/. src/journeys/runner/
 * describes itself as "the join" between this file's six trees (INTENT) and
 * docs/journeys/*-actual.md's eight role-reachability pages (REALITY) — see
 * that file's own header. But the key sets were never reconciled: six here
 * (client, setter, closer, advisor, affiliate, partner) against eight there
 * (client, role-owner, role-sales-manager, role-closer, role-funding-advisor,
 * role-inquiry-remover, affiliate, white-label). Four of these six are
 * plausibly the same real role under a shorter name (setter ≈
 * role-sales-manager, closer ≈ role-closer, advisor ≈ role-funding-advisor,
 * partner ≈ white-label); two documented roles — role-owner and
 * role-inquiry-remover — have no tree here at all. Recorded rather than
 * silently reconciled: renaming these keys would also mean rewriting the
 * fuzzy-match label text src/journeys/runner/diff.mjs's Journey/handoff
 * checks depend on, and authoring trees for the two missing roles is real
 * journey content nobody has written — not this file's call to invent.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS A COPY
 *
 * The journeys editor (public/app/journeys.html) carries these six trees in a
 * client-side seed() function, and the journeys table (migration 106) has no
 * SQL seed at all — a row only appears once someone opens the editor and
 * saves. So on a fresh database there is nothing for a runner to walk.
 *
 * This is the server-side copy the runner falls back to when the table is
 * empty. It is EXTRACTED from journeys.html, never retyped: the extraction is
 * re-run by seed-journeys.test.mjs on every test run, which deep-compares this
 * data against what the editor actually seeds and fails on any drift. The
 * duplication is real, but it cannot rot silently.
 *
 * THE PRE-EXISTING DUPLICATION IS NOT FIXED HERE. The right end state is that
 * journeys.html fetches its seed from the server rather than carrying its own,
 * which would delete one of the two copies. That is a change to a live editor
 * screen and outside this ticket — recorded as a finding rather than done
 * quietly. See the run report.
 *
 * Node shape, verbatim from the editor:
 *   { id, type, title, cfg, touches: [[category, label], ...], branches? }
 * The `branches` key is present only on a condition node: exactly two lanes,
 * each { label, nodes }. Lane labels are arbitrary per node — the seed uses
 * Yes/No on four conditions and Qualified/Not yet on the closer's.
 */

/* The ten step types the editor offers. */
export const STEP_TYPES = ["sms","email","wait","condition","stage","assign","handoff","agent","payment","record"];

/* The editor's own enumerations. The diff checks journey config against the
   CODE, never against these — but where the editor offers a choice the code
   cannot honour, that gap is the finding. It is how Sales Manager surfaces. */
export const EDITOR_ROLES = [
  "Client",
  "Setter",
  "Closer",
  "Funding Advisor",
  "Inquiry Specialist",
  "Owner",
  "Affiliate",
  "Partner"
];

export const EDITOR_STAGES = [
  "New Lead",
  "Survey Complete",
  "Booked",
  "Confirmed",
  "Showed",
  "Diagnostic Paid",
  "Decision Rendered",
  "Closed Won (deposit)",
  "Downsell",
  "Lost",
  "Apply Now",
  "Round Submitted",
  "Approved",
  "Funded",
  "Closed"
];

export const EDITOR_PIPELINES = [
  "Sales",
  "Funding: Card Stacking",
  "Funding: Alt-Fin (Lendflow)",
  "Optimization (Repair) Rounds",
  "Inquiry Removal",
  "AR / Collections",
  "Affiliates + White Label",
  "Hiring"
];

export const EDITOR_DELAYS = [
  "instant",
  "after 15 minutes",
  "after 2 hours",
  "after 1 day",
  "after 2 days",
  "24h before",
  "2h before"
];

/* The six seeded journeys, keyed as the journeys table keys them. */
export const SEED_JOURNEYS = {
  "client": {
    "name": "Client",
    "start": "Someone submits the funding form",
    "end": "They have their diagnostic — funding takes over",
    "desc": "What a business owner goes through, from filling out the form to getting their result.",
    "nodes": [
      {
        "id": "n1",
        "type": "sms",
        "title": "Text them the survey link",
        "cfg": {
          "body": "Hi {{first_name}} — Chris from Fundhub. Got your request. Quick 2-min survey so I can see what you'd qualify for: {{survey_link}}  Reply STOP to opt out.",
          "delay": "instant"
        },
        "touches": [
          [
            "Template",
            "S-01"
          ],
          [
            "Agent",
            "Setter Chris picks up the reply thread"
          ],
          [
            "Rule",
            "A2P opt-out language required"
          ]
        ]
      },
      {
        "id": "n2",
        "type": "assign",
        "title": "Give the lead to a setter",
        "cfg": {
          "role": "Setter"
        },
        "touches": [
          [
            "Journey",
            "Setter journey starts"
          ],
          [
            "Agent",
            "Setter Chris dials within 5 minutes"
          ],
          [
            "Screen",
            "Setter queue"
          ]
        ]
      },
      {
        "id": "n3",
        "type": "wait",
        "title": "Wait two days for the survey",
        "cfg": {
          "amount": "2",
          "unit": "days"
        },
        "touches": []
      },
      {
        "id": "n7",
        "type": "condition",
        "title": "Did they finish the survey",
        "cfg": {
          "field": "survey_complete",
          "op": "is true"
        },
        "touches": [],
        "branches": [
          {
            "label": "Yes",
            "nodes": [
              {
                "id": "n4",
                "type": "stage",
                "title": "Move them to Survey Complete",
                "cfg": {
                  "stage": "Survey Complete",
                  "pipeline": "Sales"
                },
                "touches": [
                  [
                    "Screen",
                    "Sales board"
                  ]
                ]
              },
              {
                "id": "n5",
                "type": "sms",
                "title": "Text them the booking link",
                "cfg": {
                  "body": "Thanks {{first_name}}. Based on what you shared there's a path here. Grab a time and I'll walk you through it: {{booking_link}}  Reply STOP to opt out.",
                  "delay": "instant"
                },
                "touches": [
                  [
                    "Template",
                    "S-02"
                  ],
                  [
                    "Screen",
                    "Closer calendar"
                  ]
                ]
              }
            ]
          },
          {
            "label": "No",
            "nodes": [
              {
                "id": "n6",
                "type": "sms",
                "title": "Nudge them once more",
                "cfg": {
                  "body": "{{first_name}} — still need those 2 minutes to see what you qualify for: {{survey_link}}  Reply STOP to opt out.",
                  "delay": "instant"
                },
                "touches": [
                  [
                    "Template",
                    "S-02b"
                  ]
                ]
              }
            ]
          }
        ]
      },
      {
        "id": "n8",
        "type": "stage",
        "title": "Move them to Booked",
        "cfg": {
          "stage": "Booked",
          "pipeline": "Sales"
        },
        "touches": [
          [
            "Screen",
            "Sales board"
          ]
        ]
      },
      {
        "id": "n9",
        "type": "sms",
        "title": "Remind them the day before",
        "cfg": {
          "body": "{{first_name}} — we're on for tomorrow at {{time}}. Bring your entity info and I'll map out what's available. Reply STOP to opt out.",
          "delay": "24h before"
        },
        "touches": [
          [
            "Template",
            "S-03"
          ]
        ]
      },
      {
        "id": "n10",
        "type": "handoff",
        "title": "Hand the call to a closer",
        "cfg": {
          "role": "Closer",
          "stage": "Call Assigned"
        },
        "touches": [
          [
            "Journey",
            "Closer journey starts"
          ],
          [
            "Screen",
            "Pre-call panel"
          ],
          [
            "Rule",
            "Only clocked-in closers get bookings"
          ]
        ]
      },
      {
        "id": "n11",
        "type": "payment",
        "title": "Take the $32 diagnostic",
        "cfg": {
          "amount": "32.00",
          "product": "Business Financial Assessment"
        },
        "touches": [
          [
            "Rule",
            "Refused unless consent was recorded"
          ],
          [
            "Rail",
            "Commas / Payva"
          ]
        ]
      },
      {
        "id": "n12",
        "type": "agent",
        "title": "Run UnderwriteIQ",
        "cfg": {
          "agent": "UnderwriteIQ",
          "note": "Soft pull, then score the file and pick a route."
        },
        "touches": [
          [
            "Agent",
            "UnderwriteIQ engine"
          ],
          [
            "Rule",
            "FCRA soft-pull consent gate"
          ],
          [
            "Screen",
            "Closer result screen"
          ]
        ]
      },
      {
        "id": "n13",
        "type": "email",
        "title": "Email the results",
        "cfg": {
          "subject": "Your Fundhub diagnostic is ready",
          "body": "{{first_name}} — your report is in the portal: {{portal_link}}. Your advisor will call to walk through it.",
          "delay": "instant"
        },
        "touches": [
          [
            "Screen",
            "portal.fundhub.ai"
          ],
          [
            "Journey",
            "Funding Advisor can start"
          ]
        ]
      }
    ]
  },
  "setter": {
    "name": "Setter",
    "start": "A new lead lands in the queue",
    "end": "Call is booked and handed to a closer",
    "desc": "The first contact. Owns the gap between a form fill and a slot on someone’s calendar.",
    "nodes": [
      {
        "id": "n14",
        "type": "agent",
        "title": "Voice agent calls them",
        "cfg": {
          "agent": "Setter Chris",
          "note": "Three attempts across the first hour."
        },
        "touches": [
          [
            "Agent",
            "Setter Chris (Bland)"
          ],
          [
            "Rule",
            "Stops at three attempts"
          ]
        ]
      },
      {
        "id": "n17",
        "type": "condition",
        "title": "Did they pick up",
        "cfg": {
          "field": "call_answered",
          "op": "is true"
        },
        "touches": [],
        "branches": [
          {
            "label": "Yes",
            "nodes": [
              {
                "id": "n15",
                "type": "sms",
                "title": "Send the survey link",
                "cfg": {
                  "body": "Here's the 2-minute survey, {{first_name}}: {{survey_link}}  Reply STOP to opt out.",
                  "delay": "instant"
                },
                "touches": [
                  [
                    "Template",
                    "N-03"
                  ]
                ]
              }
            ]
          },
          {
            "label": "No",
            "nodes": [
              {
                "id": "n16",
                "type": "sms",
                "title": "Text after the missed call",
                "cfg": {
                  "body": "Tried you just now, {{first_name}} — Chris from Fundhub. Easier to text? Tell me what you're trying to fund. Reply STOP to opt out.",
                  "delay": "instant"
                },
                "touches": [
                  [
                    "Template",
                    "N-02"
                  ]
                ]
              }
            ]
          }
        ]
      },
      {
        "id": "n18",
        "type": "stage",
        "title": "Move them to Booked",
        "cfg": {
          "stage": "Booked",
          "pipeline": "Sales"
        },
        "touches": [
          [
            "Screen",
            "Sales board"
          ]
        ]
      },
      {
        "id": "n19",
        "type": "handoff",
        "title": "Hand off to a closer",
        "cfg": {
          "role": "Closer",
          "stage": "Call Assigned"
        },
        "touches": [
          [
            "Journey",
            "Closer journey"
          ],
          [
            "Rule",
            "Setter credited for commission"
          ]
        ]
      }
    ]
  },
  "closer": {
    "name": "Closer",
    "start": "A booked call is assigned to you",
    "end": "Client is routed to funding or repair",
    "desc": "Owns the call. Takes the payment, reads the result live, and picks which way the client goes.",
    "nodes": [
      {
        "id": "n20",
        "type": "record",
        "title": "Load the pre-call panel",
        "cfg": {
          "note": "Survey answers, past conversations, any earlier rounds."
        },
        "touches": [
          [
            "Screen",
            "Pre-call panel"
          ],
          [
            "Rule",
            "Only clients from your company"
          ]
        ]
      },
      {
        "id": "n21",
        "type": "payment",
        "title": "Take the $32 on the call",
        "cfg": {
          "amount": "32.00",
          "product": "Business Financial Assessment"
        },
        "touches": [
          [
            "Rule",
            "Consent captured first"
          ],
          [
            "Rail",
            "Commas / Payva"
          ]
        ]
      },
      {
        "id": "n22",
        "type": "agent",
        "title": "Run UnderwriteIQ",
        "cfg": {
          "agent": "UnderwriteIQ",
          "note": "Result renders while the client is still on the phone."
        },
        "touches": [
          [
            "Agent",
            "UnderwriteIQ engine"
          ],
          [
            "Rule",
            "Blank fields show as unknown, never zero"
          ]
        ]
      },
      {
        "id": "n28",
        "type": "condition",
        "title": "Do they qualify for funding",
        "cfg": {
          "field": "underwrite_route",
          "op": "= funding"
        },
        "touches": [],
        "branches": [
          {
            "label": "Qualified",
            "nodes": [
              {
                "id": "n23",
                "type": "stage",
                "title": "Close them to deposit",
                "cfg": {
                  "stage": "Closed Won (deposit)",
                  "pipeline": "Sales"
                },
                "touches": [
                  [
                    "Rule",
                    "Commission splits read from the table"
                  ]
                ]
              },
              {
                "id": "n24",
                "type": "sms",
                "title": "Text the good news",
                "cfg": {
                  "body": "{{first_name}} — you're approved to move forward. {{lender}} came back at {{amount}}. Your advisor will call today. Reply STOP to opt out.",
                  "delay": "instant"
                },
                "touches": [
                  [
                    "Template",
                    "F-03"
                  ]
                ]
              },
              {
                "id": "n25",
                "type": "handoff",
                "title": "Hand to a funding advisor",
                "cfg": {
                  "role": "Funding Advisor",
                  "stage": "File Received"
                },
                "touches": [
                  [
                    "Journey",
                    "Funding Advisor journey"
                  ]
                ]
              }
            ]
          },
          {
            "label": "Not yet",
            "nodes": [
              {
                "id": "n26",
                "type": "stage",
                "title": "Move them to Downsell",
                "cfg": {
                  "stage": "Downsell",
                  "pipeline": "Sales"
                },
                "touches": []
              },
              {
                "id": "n27",
                "type": "record",
                "title": "Attach the dispute letters",
                "cfg": {
                  "note": "DS-02 pack. Repair path only."
                },
                "touches": [
                  [
                    "Rule",
                    "Never on the funding route"
                  ],
                  [
                    "Journey",
                    "Optimization rounds"
                  ]
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  "advisor": {
    "name": "Funding Advisor",
    "start": "A qualified file lands on your desk",
    "end": "Round is funded",
    "desc": "Runs the actual capital rounds — picks the lenders, submits, chases the missing documents.",
    "nodes": [
      {
        "id": "n29",
        "type": "record",
        "title": "Open a funding round",
        "cfg": {
          "note": "Lender set comes from the Bank and Lender Match List."
        },
        "touches": [
          [
            "Screen",
            "Advisor dashboard"
          ],
          [
            "Rule",
            "Round scoped to one company"
          ]
        ]
      },
      {
        "id": "n30",
        "type": "stage",
        "title": "Submit the round",
        "cfg": {
          "stage": "Round Submitted",
          "pipeline": "Funding: Card Stacking"
        },
        "touches": [
          [
            "Rule",
            "Alt-fin moves only on Lendflow webhooks"
          ]
        ]
      },
      {
        "id": "n31",
        "type": "sms",
        "title": "Tell them it went out",
        "cfg": {
          "body": "Round submitted, {{first_name}}. Decisions usually land in 24-72 hours. I'll text as they come in. Reply STOP to opt out.",
          "delay": "instant"
        },
        "touches": [
          [
            "Template",
            "F-02"
          ]
        ]
      },
      {
        "id": "n32",
        "type": "wait",
        "title": "Wait on lender decisions",
        "cfg": {
          "amount": "3",
          "unit": "days"
        },
        "touches": []
      },
      {
        "id": "n33",
        "type": "stage",
        "title": "Mark it funded",
        "cfg": {
          "stage": "Funded",
          "pipeline": "Funding: Card Stacking"
        },
        "touches": [
          [
            "Screen",
            "Client finance dashboard"
          ],
          [
            "Journey",
            "Owner revenue roll-up"
          ]
        ]
      }
    ]
  },
  "affiliate": {
    "name": "Affiliate",
    "start": "An affiliate is approved",
    "end": "Referral is credited",
    "desc": "Sends leads under a tracked link and gets paid when one closes.",
    "nodes": [
      {
        "id": "n34",
        "type": "record",
        "title": "Create the affiliate record",
        "cfg": {
          "note": "Commission rate is read from the compensation table."
        },
        "touches": [
          [
            "Rule",
            "Rate is never hardcoded"
          ]
        ]
      },
      {
        "id": "n35",
        "type": "email",
        "title": "Send their link",
        "cfg": {
          "subject": "Your Fundhub referral link",
          "body": "Your tracked link, QR code, and how payouts work.",
          "delay": "instant"
        },
        "touches": [
          [
            "Screen",
            "Affiliate portal — not built yet"
          ]
        ]
      },
      {
        "id": "n36",
        "type": "handoff",
        "title": "Send the referral to a setter",
        "cfg": {
          "role": "Setter",
          "stage": "Lead Assigned"
        },
        "touches": [
          [
            "Journey",
            "Setter journey"
          ],
          [
            "Rule",
            "Referral stamped at click time"
          ]
        ]
      }
    ]
  },
  "partner": {
    "name": "White-Label Partner",
    "start": "A partner signs the agreement",
    "end": "Partner is operating",
    "desc": "Runs Fundhub under their own brand, inside their own walled-off scope.",
    "nodes": [
      {
        "id": "n37",
        "type": "record",
        "title": "Create the partner company",
        "cfg": {
          "note": "Isolated scope. Partner A can never read partner B."
        },
        "touches": [
          [
            "Rule",
            "Row-level security, enforced"
          ]
        ]
      },
      {
        "id": "n38",
        "type": "agent",
        "title": "Apply their brand",
        "cfg": {
          "agent": "Brand Studio",
          "note": "Colors, typefaces, entity name, domain."
        },
        "touches": [
          [
            "Screen",
            "Brand Studio"
          ],
          [
            "Rule",
            "Writes gated to owner and admin"
          ]
        ]
      },
      {
        "id": "n39",
        "type": "email",
        "title": "Invite their team",
        "cfg": {
          "subject": "Your Fundhub seat is ready",
          "body": "Role-scoped access for each team member.",
          "delay": "instant"
        },
        "touches": [
          [
            "Journey",
            "Every staff journey, in partner scope"
          ]
        ]
      }
    ]
  }
};

export const JOURNEY_ORDER = ["client", "setter", "closer", "advisor", "affiliate", "partner"];

export default SEED_JOURNEYS;
