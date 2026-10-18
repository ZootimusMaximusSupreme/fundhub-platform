# CRM and portal layout audit — 2026-10-18

Owner request: inspect why the real CRM and client portal feel confusing and unprofessional. Do not treat the existing CRM design rules as the visual authority. Reference: the supplied Fundhub Mac entry screen, with off-white canvas, bold rounded black type, generous spacing, simple primary/secondary actions and restrained color.

The initial diagnosis was a read-only product/design review. Chris then authorized implementation below. No new plan gate and no production deployment. The current private Gemini-design Site is a separate single-file mockup and must not be presented as the working CRM. Existing branch `codex/client-portal-ios-redo`, PR #67, is the implementation being inspected. Unrelated dirty journey files, call screenshots and funnel media remain untouched.

## Concrete assignments

| Workflow | Actual agent | Scope | State |
| --- | --- | --- | --- |
| Lead | `/root` | Inventory, representative desktop/phone renders, measured layout evidence, combined diagnosis and correction priorities | In progress |
| Staff structure audit | `/root/audit_staff_structure` | Staff navigation, overlap, context and page hierarchy; read only | Started |
| Client structure audit | `/root/audit_client_layout` | Portal/FinanceOS navigation, layout hierarchy and conditional states; read only | Started |

These are audit agents, not additional page implementation builders. Both reviews run in parallel with the lead's renders; the combined findings wait for their results.

## Self-contained audit prompts

Staff: Inspect `/workspace/scratch/b680c1d27381/fundhub-cloud` at `codex/client-portal-ios-redo`. Read AGENTS.md. Perform a read-only UX review of shell.js, sidebar.fragment.html, Pipeline, Client Control Panel, Closer Dashboard, My numbers, Sales floor, Finance OS and related client operations. Explain overlap, naming, page hierarchy and context switching with source references and user impact. Use the owner's clean Fundhub Mac screen as the visual direction; current UI standards are evidence, not the design authority. Do not edit code, start builders, inspect customer records, make API writes or deploy. Return concrete prioritized findings to the lead.

Client: Inspect the same checkout/branch. Read AGENTS.md. Perform a read-only UX review of Client Home, shared client chrome, FinanceOS, Money pages, Affiliate and client entry paths. Trace repeated summaries, competing next actions, wayfinding, layout constraints and conditional states. Separate rendered evidence from source inference. Preserve features and permission boundaries. Do not edit code, start builders, inspect customer data, make API writes or deploy. Return concrete prioritized findings to the lead.

## Evidence standard

Inventory the whole app page set; render representative actual source pages using safe API fixtures, with all writes intercepted. State clearly that fixture renders are not a live account/session audit. Mark review screenshots with red boxes and captions. Check desktop and phone layout; do not infer professional usability merely from an overflow assertion or passing click test.

## Checkpoint

Two audit agents are actually started. First source finding: overlapping workspaces and a shared shell that injects global layout overrides require page-by-page scrutiny. No app code changed.

## Authorized implementation checkpoint

Chris authorized the fixes after the diagnosis: “once figured out fix with ultra,” “make it sexy,” and “It shouldnt look vibe coded ... professionally ... high end budget.” New isolated worktree `fundhub-layout`, branch `codex/crm-portal-layout-professional`, starts at local `a4b84be`; unrelated dirty files in the previous checkout are excluded. No production deployment.

Root owns client shared styles/navigation and integration; `/root/workspace_foundation` (Ultra, actually started) owns staff shared shell/navigation/tokens. Every actual page has ONE distinct builder and self-contained prompt below; planned rows are not active agents. Retained Home builder is reused. New builders explicitly run Ultra. Exact inventory and status: [manifest](crm-portal-layout-manifest.json). Compatibility entry/redirect/fragment files are not turned into new pages.

### Diagnosis supported by source and safe fixture renders

- Staff sidebar exposes21 owner destinations across6 groups while mixing daily work, reports and setup; client context changes between custom pickers.
- Shared fontinherit!important flattened hierarchy; pages accumulated exceptions. Foundation removes that mechanism.
- Phone Pipeline uses almost the first700px on chrome/summary/controls before board.
- Home used giant generic headings while next work fell below the fold; original118IDs remain in the revised Home.
- FinanceOS16equal scrolling tabs hide common accounts/payments functions. Revised frame groups them and retains every key.
- Headers/wordmarks/status diagnostics and internal codes compete with actual work. Diagnostics are not proof of usability.
- Safe source-fixture rendering covered10 representative pages at1440/390 (20captures), with no page JS errors; not a live session/permission or data acceptance proof. Existing API mocks and fonts blocked externally; empty fixture values are not product defects.

### Single-page assignments

| Actual page | Single builder | Current state | Self-contained prompt |
| --- | --- | --- | --- |
| `public/app/affiliate.html` | `/root/page_affiliate` | active | [prompt](crm-portal-layout-prompts/affiliate.md) |
| `public/app/agent-editor.html` | `/root/page_agent_editor` | planned; not started | [prompt](crm-portal-layout-prompts/agent-editor.md) |
| `public/app/automations.html` | `/root/page_automations` | planned; not started | [prompt](crm-portal-layout-prompts/automations.md) |
| `public/app/brand-studio.html` | `/root/page_brand_studio` | planned; not started | [prompt](crm-portal-layout-prompts/brand-studio.md) |
| `public/app/calendar.html` | `/root/page_calendar` | active | [prompt](crm-portal-layout-prompts/calendar.md) |
| `public/app/campaign-manager.html` | `/root/page_campaign_manager` | planned; not started | [prompt](crm-portal-layout-prompts/campaign-manager.md) |
| `public/app/client-control-panel.html` | `/root/page_client_control_panel` | page checks passed; integrated review pending | [prompt](crm-portal-layout-prompts/client-control-panel.md) |
| `public/app/client-portal.html` | `/root/page_client_portal` | page checks passed; integrated review pending | [prompt](crm-portal-layout-prompts/client-portal.md) |
| `public/app/closer-dashboard.html` | `/root/page_closer_dashboard` | page checks passed; integrated review pending | [prompt](crm-portal-layout-prompts/closer-dashboard.md) |
| `public/app/company-brain.html` | `/root/page_company_brain` | planned; not started | [prompt](crm-portal-layout-prompts/company-brain.md) |
| `public/app/consent-capture.html` | `/root/page_consent_capture` | planned; not started | [prompt](crm-portal-layout-prompts/consent-capture.md) |
| `public/app/content-admin.html` | `/root/page_content_admin` | planned; not started | [prompt](crm-portal-layout-prompts/content-admin.md) |
| `public/app/contracts.html` | `/root/page_contracts` | planned; not started | [prompt](crm-portal-layout-prompts/contracts.md) |
| `public/app/creative-factory.html` | `/root/page_creative_factory` | planned; not started | [prompt](crm-portal-layout-prompts/creative-factory.md) |
| `public/app/csm-queue.html` | `/root/page_csm_queue` | planned; not started | [prompt](crm-portal-layout-prompts/csm-queue.md) |
| `public/app/documents.html` | `/root/page_documents` | active | [prompt](crm-portal-layout-prompts/documents.md) |
| `public/app/finance-os.html` | `/root/page_finance_os` | planned; not started | [prompt](crm-portal-layout-prompts/finance-os.md) |
| `public/app/financeos.html` | `/root/page_financeos_frame` | page checks passed; integrated review pending | [prompt](crm-portal-layout-prompts/financeos.md) |
| `public/app/galaxy.html` | `/root/page_galaxy` | planned; not started | [prompt](crm-portal-layout-prompts/galaxy.md) |
| `public/app/hiring.html` | `/root/page_hiring` | planned; not started | [prompt](crm-portal-layout-prompts/hiring.md) |
| `public/app/inquiry-remover.html` | `/root/page_inquiry_remover` | planned; not started | [prompt](crm-portal-layout-prompts/inquiry-remover.md) |
| `public/app/journeys.html` | `/root/page_journeys` | planned; not started | [prompt](crm-portal-layout-prompts/journeys.md) |
| `public/app/lenders.html` | `/root/page_lenders` | planned; not started | [prompt](crm-portal-layout-prompts/lenders.md) |
| `public/app/marketing-command-center.html` | `/root/page_marketing_command_center` | planned; not started | [prompt](crm-portal-layout-prompts/marketing-command-center.md) |
| `public/app/messaging.html` | `/root/page_messaging` | planned; not started | [prompt](crm-portal-layout-prompts/messaging.md) |
| `public/app/money-accounts.html` | `/root/page_money_accounts` | page checks passed; integrated review pending | [prompt](crm-portal-layout-prompts/money-accounts.md) |
| `public/app/money-alerts.html` | `/root/page_money_alerts` | planned; not started | [prompt](crm-portal-layout-prompts/money-alerts.md) |
| `public/app/money-banks.html` | `/root/page_money_banks` | planned; not started | [prompt](crm-portal-layout-prompts/money-banks.md) |
| `public/app/money-connections.html` | `/root/page_money_connections` | active | [prompt](crm-portal-layout-prompts/money-connections.md) |
| `public/app/money-credit.html` | `/root/page_money_credit` | page checks passed; integrated review pending | [prompt](crm-portal-layout-prompts/money-credit.md) |
| `public/app/money-declines.html` | `/root/page_money_declines` | planned; not started | [prompt](crm-portal-layout-prompts/money-declines.md) |
| `public/app/money-fundability.html` | `/root/page_money_fundability` | planned; not started | [prompt](crm-portal-layout-prompts/money-fundability.md) |
| `public/app/money-helper.html` | `/root/page_money_helper` | planned; not started | [prompt](crm-portal-layout-prompts/money-helper.md) |
| `public/app/money-next.html` | `/root/page_money_next` | planned; not started | [prompt](crm-portal-layout-prompts/money-next.md) |
| `public/app/money-payments.html` | `/root/page_money_payments` | page checks passed; integrated review pending | [prompt](crm-portal-layout-prompts/money-payments.md) |
| `public/app/money-plan.html` | `/root/page_money_plan` | planned; not started | [prompt](crm-portal-layout-prompts/money-plan.md) |
| `public/app/money-setup.html` | `/root/page_money_setup` | planned; not started | [prompt](crm-portal-layout-prompts/money-setup.md) |
| `public/app/money-strategy.html` | `/root/page_money_strategy` | planned; not started | [prompt](crm-portal-layout-prompts/money-strategy.md) |
| `public/app/money-transfers.html` | `/root/page_money_transfers` | planned; not started | [prompt](crm-portal-layout-prompts/money-transfers.md) |
| `public/app/money-vault.html` | `/root/page_money_vault` | planned; not started | [prompt](crm-portal-layout-prompts/money-vault.md) |
| `public/app/money.html` | `/root/page_money_overview` | page checks passed; integrated review pending | [prompt](crm-portal-layout-prompts/money.md) |
| `public/app/morning-brief.html` | `/root/page_morning_brief` | planned; not started | [prompt](crm-portal-layout-prompts/morning-brief.md) |
| `public/app/my-numbers.html` | `/root/page_my_numbers` | planned; not started | [prompt](crm-portal-layout-prompts/my-numbers.md) |
| `public/app/ops-admin.html` | `/root/page_ops_admin` | planned; not started | [prompt](crm-portal-layout-prompts/ops-admin.md) |
| `public/app/partner-galaxy.html` | `/root/page_partner_galaxy` | planned; not started | [prompt](crm-portal-layout-prompts/partner-galaxy.md) |
| `public/app/partner-training.html` | `/root/page_partner_training` | planned; not started | [prompt](crm-portal-layout-prompts/partner-training.md) |
| `public/app/payment-success.html` | `/root/page_payment_success` | planned; not started | [prompt](crm-portal-layout-prompts/payment-success.md) |
| `public/app/pipeline.html` | `/root/page_pipeline` | page checks passed; integrated review pending | [prompt](crm-portal-layout-prompts/pipeline.md) |
| `public/app/present.html` | `/root/page_present` | planned; not started | [prompt](crm-portal-layout-prompts/present.md) |
| `public/app/products-commissions.html` | `/root/page_products_commissions` | planned; not started | [prompt](crm-portal-layout-prompts/products-commissions.md) |
| `public/app/sales-floor.html` | `/root/page_sales_floor` | planned; not started | [prompt](crm-portal-layout-prompts/sales-floor.md) |
| `public/app/social-studio.html` | `/root/page_social_studio` | planned; not started | [prompt](crm-portal-layout-prompts/social-studio.md) |
| `public/app/soft-pull-approve.html` | `/root/page_soft_pull_approve` | planned; not started | [prompt](crm-portal-layout-prompts/soft-pull-approve.md) |
| `public/app/staff-teams.html` | `/root/page_staff_teams` | planned; not started | [prompt](crm-portal-layout-prompts/staff-teams.md) |
| `public/app/teleprompter-remote.html` | `/root/page_teleprompter_remote` | planned; not started | [prompt](crm-portal-layout-prompts/teleprompter-remote.md) |
| `public/app/teleprompter.html` | `/root/page_teleprompter` | planned; not started | [prompt](crm-portal-layout-prompts/teleprompter.md) |
| `public/login.html` | `/root/page_login` | planned; not started | [prompt](crm-portal-layout-prompts/login.md) |
| `public/portal-login.html` | `/root/page_portal_login` | active | [prompt](crm-portal-layout-prompts/portal-login.md) |
| `public/reset-password.html` | `/root/page_reset_password` | planned; not started | [prompt](crm-portal-layout-prompts/reset-password.md) |
| `public/contract.html` | `/root/page_contract` | planned; not started | [prompt](crm-portal-layout-prompts/contract.md) |
| `public/progress.html` | `/root/page_progress` | planned; not started | [prompt](crm-portal-layout-prompts/progress.md) |

Root will update status from actual messages, never inferred activity. Independent feature preservation and design review follow integration; live referral/sample proofs are retained separately from mocked UI checks.

### Short build checkpoint

9/61 actual pages have completed their individual refinement checks;52remain (5pageagents currentlyactive,47planned). Shared staff foundation passes101focusedNodechecks and9desktop/phonebrowsercases; all navigation/API/permissioncontractsretained. Rootclientchrome adds directlydiscoverableDocumentsandconsistent16sectionMoneypicker; referralsstayrealandown-scoped. Currentworktreeis`fundhub-layout`, branch`codex/crm-portal-layout-professional`. Noexternalaccessblockerandnoowneractionneeded. Next: finishpagewaves, synchronizecanonicalsidebar, runintegratedfeature/designreviewandpushtheworkingdraft. Notproductiondeployed.

### Integration checkpoint — common client header
One60px phone/64px desktop header now owns location, actual client chat and Account. Sign out and the retained Open Money workspace/back links live in Account; phone Money navigation is one complete section control. Legacy IDs and their updates remain, staff surfaces untouched. Dedicated Money/progress pages reuse the real portal chat rather than a new API. Existing pre-call Home auto-open stays unchanged.27 combined referral/sample/header-dependent Home/FinanceOS/Helper regressions pass; role/partner brand12checks pass. Header geometry across routes is under focused verification.

Source-only pre-existing limitation noted during password page review: legacy next validation accepts a protocol-relative address because it tests startsWith('/'). No redirect/auth behavior was changed in this layout refinement; not live-verified or represented as newly fixed.
