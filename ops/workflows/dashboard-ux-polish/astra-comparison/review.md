# One-page Astra comparison — independent review

Owner selected Astra extra-high for the broader CRM, customer portal and affiliate rollout on 2026-10-20. This comparison itself remains a local draft; no production page has been replaced.

- Same 27 fictional staff on each version. No real staff, customer, mailbox or database connection.
- Current and Astra captured at 1440 and 390: full, empty, loading and error, plus editor, permissions, clock and telemetry.
- Both widths and versions passed roster count, role filter, email filter, editor open/cancel, permissions tab, clock tab, telemetry person selection and refresh. No page exceptions; page width matches viewport.
- Original action script is byte-identical. Original data-read script differs only by the declared presentation-state hook. Added script handles presentation states and existing keyboard actions.
- Lint: 4,005 files/scripts parse clean. TypeScript: passed. New preview scripts parse; whitespace check passed.
- UI §11: initial Astra phone values were clipped. Original failed screenshot is retained as `evidence/astra-phone-clipping-before-fix-MARKED.png`. Builder repaired the shared intrinsic table-width interaction in the phone-only draft rule; final independent measurement: table and all rows end at x=373, equal to the wrapper edge. No page overflow at 390.
- Baseline loading shows an empty roster; Astra shows a layout skeleton. Baseline roster is a horizontally scrolling table on phone; Astra uses labeled stacked records.

Limits: these are controlled local visual and core-control checks, not real iPhone/Safari, native Mac app, production write/persistence or complete role-workflow proof. Lighthouse was not run; this draft is not declared production-ready. The complete current page inventory remains a separate rollout task.

Preview: `http://127.0.0.1:43229/comparison`. Keep the local server running with `node ops/workflows/dashboard-ux-polish/astra-comparison/preview-server.mjs`.
