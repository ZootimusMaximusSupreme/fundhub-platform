# hiring-funnel-flow — fundhub.ai/join/ (actual)

Owner-set 2026-10-13 (Chris, in chat): a hiring funnel for setters, closers, CSMs
and a COO, built like the book-a-call funnel. VSL page, then an application
survey, then qualified applicants book on the sales manager's calendar. The COO
books with Chris. LinkedIn is required.

Traced from the code on 2026-10-13:
`public/join/index.html`, `public/join/apply/index.html`,
`api/hiring/apply.mjs`, `src/hiring/apply-public.mjs`, `src/hiring/survey.mjs`,
`src/hiring/pipeline.mjs apply()`, `db/migrations/480_hiring_coo_req.sql`.

## The applicant's path

```mermaid
flowchart TD
    A["/join/ — VSL page<br/>headline, video slot, four seats"] -->|Apply Now or a seat card| B["/join/apply/ — survey card<br/>?role= skips the seat step"]
    B --> C["1. Seat: setter, closer, CSM, COO"]
    C --> D["2. Contact: name, email, phone,<br/>LinkedIn (required)"]
    D --> E["3. The seat's questions<br/>(src/hiring/survey.mjs QUESTIONS)"]
    E --> F["4. 90-second Loom link (required)"]
    F -->|"POST /api/hiring/apply<br/>funnel: join"| G{"parseApplyBody()<br/>every answer one of the options?<br/>LinkedIn, phone, Loom present?"}
    G -->|no| H["400 with one error code<br/>page sends them back to the step"]
    G -->|yes| I["submitApplication()<br/>candidate + application saved<br/>stage applied, status open<br/>answers + survey_version + review_flags<br/>Loom on video_url"]
    I --> J["apply() opens a New application task<br/>sales_manager for setter, closer, CSM<br/>owner (Chris) for COO"]
    I --> K{"routeFor()<br/>part-time only?<br/>closer never over $3,000?"}
    K -->|a rule fired| L["next: review<br/>thank-you: we review every application"]
    K -->|no rule| M{"seat has interview_booking_url?"}
    M -->|yes| N["next: book + bookingUrl<br/>calendar opens under the card"]
    M -->|no| O["next: book_pending<br/>thank-you: we will reach out"]
```

## What each state means for the record

| Screen the applicant sees | What is in the database | Who acts next |
|---|---|---|
| Calendar (`book`) | Application open in `applied`, `review_flags` empty | Applicant picks a time on the seat's calendar. Sales manager (or Chris for COO) already has the task. |
| "We will reach out" (`book_pending`) | Same as above | The seat has no booking link yet. The task owner reaches out by hand. |
| "We review every application" (`review`) | Application open in `applied`, `review_flags` lists the rule ids | The task owner reviews it. Nothing was rejected; a person decides. |

## Rules that hold

- No candidate is rejected by software. `review` only holds the calendar back. The
  application stays `open` and no `hiring_decisions` row is written
  (proved in `src/hiring/apply-public.pg.test.mjs`).
- The reply never says whether the email was already on file, and a honeypot bot
  gets the same reply a person with the same answers would get (same test file).
- The page's copy of the questions must match `pageSurvey()` word for word
  (`src/hiring/survey.test.mjs`).
- The old `/careers.html` form is unchanged: it still cannot send answers.

## Open gaps

- `interview_booking_url` is not set for any seat in this repo. Until the sales
  manager's link (setter, closer, CSM) and Chris's link (COO) are saved on
  `hiring_roles`, every qualified applicant sees "we will reach out".
- The VSL is not filmed. `/join/` shows a placeholder until
  `public/funnel/hiring-vsl.mp4` exists.
- The calendar is an outside page in a frame, so this system is not told when an
  interview is booked. `hiring_interviews` is still only written by tests.
