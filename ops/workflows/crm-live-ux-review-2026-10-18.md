# Review of the current live CRM and portal

Owner steering: review what is already live before publishing the next wave. Further production publication is on hold during this UX review; original page builders may finish their source and safe tests. Prior production authorization remains recorded, but a passing test alone does not settle this visual review.

## Scope and evidence

36pages are published through PR#71/source7719773083f07ea71f762d8428f170d35016d5bf. This first lead review inspected the retained1440px/390px captures of My Numbers and Pipeline plus ordinary-empty and designated-sample client Home. The captures use fictional API fixtures against the source that was tested and subsequently published. Postdeploy source hashes matched19key live assets; separate publicHTTP reads confirmed Home/My Numbers/font CSS. These are layout evidence, not fresh authenticated production-session screenshots or a full36/61-page visual signoff.

## Findings to address

1. **Font match remains incomplete.** The owner reference uses native SF Pro Rounded. Mac Chrome uses the licensed Nunito fallback. It is rounded, but that is not proof of an exact match to the reference. Compare real Safari/Chrome rendering on the target Mac before declaring type finished; preserve partner/custom fonts.
2. **Client Home spends too much space before the useful status.** Welcome, generic Review your account/Open your account, file status, View progress and Account & history repeat entry points. In the390px sample capture the main file state and action consume almost the entire viewport. Tighten this hierarchy while retaining every real conditional next action, file status, account detail and navigation control. Do not invent a Step2of4 or fake file progress.
3. **Empty My Numbers cards are oversized.** The black cash card devotes considerable space to no target/no team rank, with a large empty attention card beside it. Keep zero distinct from unknown and retain all metrics; make missing-data states more compact and make any real next task clear.
4. **Pipeline has too many stacked controls before the board.** Rail tabs, summary counters, board-mode controls and filters occupy several rows. Its thin/empty fixture card shows three unexplained dashes. Group the controls and explain missing fields without removing rails, fulfillment, filters, search, New Client, Move/Archive, role behavior or record detail.
5. **Cross-page consistency still needs completion.**36of61pages are published; transitions into old pages remain a real product problem. The remaining pages must follow the corrected working pattern rather than proliferating another variation.

## Next work

Review and fix these issues with each page's SAME original builder: Home, My Numbers and Pipeline; lead owns shared typography/navigation. Preserve original assignments and all APIs/permissions/data/actions. Check1440/390/320 and loading/empty/error/full states plus touch/keyboard. Run the integrated functional/security/database/performance proof after fixes. Keep the next-wave PR#74 draft while the visual review is unresolved. No production deployment during this review. The old ZIP remains superseded; final packaging still waits for the full final integration.
