# Astra Team & access comparison

Draft only. Isolated from the current product page and release. Root owns the fixture data, browser review, evidence and owner comparison.

## Layout

- Keep Fundhub’s shared sidebar, official wordmark, F menu mark, Nunito and pastel spectrum.
- Put the people-management task first: “Your team,” one Add person action, then the roster.
- Replace four detached metric cards with one four-part summary. “Not active” accurately describes the existing count of invited and revoked logins.
- Use quiet, sentence-case tabs and labels. Search and role filters sit directly above the people they affect.
- Give each person a clear name/email hierarchy. Roles use plain text; consent and login retain explicit status words.
- On a phone, summaries become short rows and each person becomes one stacked record with labeled Role, Consent, Shift and Login values.
- Keep the existing editor, with readable field groups and a separated Revoke login action.
- Shorten the static Role access explanation. Its permission list remains unavailable; no permission matrix or new control was invented.
- Put the existing monitoring explanation in a disclosure. Clock and telemetry controls keep their original actions.

## Scope and behavior

Files owned by this lane:

- `team-access.html`
- `team-access.css`
- `design-notes.md`

The first original inline script is byte-identical. The second is byte-identical apart from this presentation hook around the existing roster promise:

```js
FHData.staff({ limit: 200 }).then(function (result) {
  if (window.AstraTeamUI) window.AstraTeamUI.setReadResult(result);
  return result;
})
```

A third, separate presentation script renders a skeleton while that promise is pending and a reload action on a failed read. The original successful render still controls actual roster data and statistics. Empty and filtered states use existing Add person and filter controls. No endpoint, authorization, consent, confirmation, invite, password-reset, clock, telemetry or agreement behavior changes.

That presentation script also labels existing fields and allows the existing row and switch actions to be used by keyboard.

All original element IDs are retained, with no duplicates. Original relative app assets still resolve at `/app/staff-teams.html?variant=astra`. The draft stylesheet loads from `/__comparison/team-access.css`.

## Build checks

- All three inline scripts parse.
- Original script equality verified as described above.
- No missing or duplicate original IDs.
- Git whitespace check passed.
- No dependencies, production files, credentials or customer data changed.
- No commit or deployment performed by this lane.

Root independently checks 1440px and 390px, full/loading/empty/error states and working controls with fictional fixture data. This lane does not grade its own screen. Browser evidence and performance measurement remain root’s responsibility.

## Independent review repair

Root found clipped right-side values in the 390px stacked roster. Diagnosis measured a 392.75px table inside a 356px card: the shared scroll wrapper set `min-width:max-content` on the table. The phone-only roster rule now sets `min-width:0`. A repair measurement shows a 356px table, all 27 row edges at x=373 inside the card’s x=374 edge, and a 390px page. Root owns the final visual recapture.
