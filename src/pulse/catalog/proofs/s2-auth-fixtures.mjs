// The stand-in answers the sign-in link doors share (magic link, portal link,
// authorized representative): the company lookup, the rate counter, the account
// and client lookups, the link row, the message template and the queue insert.
// Used by src/http/s2-message-routes-auth.test.mjs and
// src/http/s2-message-routes-reset-rep.test.mjs.
import { ORG_ID } from "../../../testing/handler-harness.mjs";
import { CLIENT, clientIn } from "./s2-route-kit.mjs";

export const OTHER_CLIENT = "c9000000-0000-4000-8000-000000000009";
export const EMAIL = "dana.whitfield@example.test";
export const OWNER_ADMIN = Object.freeze(["owner", "admin"]);

const LINK_ROW = "1c000000-0000-4000-8000-000000000001";
const MSG_ROW = "ee000000-0000-4000-8000-000000000001";

export const org = [/FROM orgs WHERE slug/, [{ id: ORG_ID }]];
export const noLimit = [/FROM account_magic_links m/, [{ email_count: 0, ip_count: 0 }]];
export const hammered = [/FROM account_magic_links m/, [{ email_count: 3, ip_count: 0 }]];
export const noAccount = [/FROM accounts\s+WHERE org_id = \$1 AND lower\(email\)/, []];
export const clientByEmail = [/FROM clients\s+WHERE org_id = \$1 AND lower\(email\)/, [{ id: CLIENT }]];
export const linkInsert = [/INSERT INTO account_magic_links/, [{ id: LINK_ROW }]];
export const template = [/FROM message_templates/, [{
  body: "Hi {{contact.first_name}}, sign in here: {{magic_link.url}} (good for {{magic_link.expires_minutes}} minutes)",
  subject: "Your Fundhub sign-in link",
  compliance_passed: true,
}]];
export const clientRow = [/FROM clients WHERE id = \$1 LIMIT 1/, [{
  first_name: "Dana", last_name: "Whitfield", email: EMAIL, phone: "+16025550100", custom_fields: {},
}]];
export const queued = [/INSERT INTO messages/, [{ id: MSG_ROW, created_at: "2026-10-13T17:00:00Z" }]];

/** "Is this client in this company" for the statements the two handlers ask. */
export const inOrg = (re, row) => clientIn(re, row);
