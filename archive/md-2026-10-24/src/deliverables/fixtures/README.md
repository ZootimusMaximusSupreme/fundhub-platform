# Deliverables test fixtures

Nothing here is hand-written.

| file | what it is | how it was made |
|---|---|---|
| `jordan-sample-client.json` | the `CLIENT` dict at `scripts/black-reports/fundhub_gen.py:27-197` | `json.dumps(fundhub_gen.CLIENT)` |
| `python-charts.json` | the twelve shared primitives the Python emits (8 charts, `_box`, `util_bar`, `table`, `section`) | called each Python function with the inputs recorded in `port-parity.test.mjs` |
| `python-bodies.json` | the four document bodies the Python emits for the Jordan Sample client | `build_credit_analysis` / `build_funding_snapshot` / `build_lender_list` / `build_roadmap` |
| `academy-client.json` | the CLIENT dict a **clean 750s** simulated file produces | `src/deliverables/preview.mjs` → `simulatedClient("academy")` |
| `repair-client.json` | the CLIENT dict a **damaged high-500s** simulated file produces, 9 negatives incl. a charge-off | `simulatedClient("repair", …)` |

The two simulated clients run the `scripts/sim/push-credit.mjs` profiles through the
real tier engine and then through `src/underwrite/black-report-client.mjs`, so they
are the shape a real client produces, not an invented one. No bureau was called and
no database was touched.

`fundhub_gen.py` imports WeasyPrint at module scope and WeasyPrint is not installed
on this machine. The capture stubbed `sys.modules["weasyprint"]` with an empty module
— nothing below the import is used by the four builders, which only return strings.

To recapture after a change to the Python, see the header of `port-parity.test.mjs`.
