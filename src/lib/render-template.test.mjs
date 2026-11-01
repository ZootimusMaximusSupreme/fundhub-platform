import { test } from "node:test";
import assert from "node:assert";
import { renderTemplate, stripEmptyWhereRow } from "./render-template.mjs";

test("replaces known tokens", () => {
  assert.equal(renderTemplate("Hello {{first_name}}!", { first_name: "Alice" }), "Hello Alice!");
});

test("handles whitespace inside braces: {{ first_name }}", () => {
  assert.equal(renderTemplate("Hi {{ first_name }}.", { first_name: "Bob" }), "Hi Bob.");
});

test("unknown tokens become empty string", () => {
  const result = renderTemplate("Hi {{unknown_field}}.", {});
  assert.equal(result, "Hi .");
});

test("multiple tokens replaced", () => {
  const body = "{{greeting}} {{first_name}}, your score is {{score}}.";
  const result = renderTemplate(body, { greeting: "Hey", first_name: "Alice", score: "720" });
  assert.equal(result, "Hey Alice, your score is 720.");
});

test("null value in context renders as empty string", () => {
  assert.equal(renderTemplate("Name: {{name}}", { name: null }), "Name: ");
});

test("non-string body coerced to string", () => {
  assert.equal(renderTemplate(42, {}), "42");
});

// --- dotted merge tags ------------------------------------------------------
// THE BUG: TOKEN_RE was /\{\{\s*(\w+)\s*\}\}/g and `\w` excludes `.`, so no dotted tag
// ever matched. The entire ported the CRM copy is written in dotted tags, so every one of
// them rendered literally — braces and all — into outbound SMS and email.

test("REGRESSION: dotted tags resolve instead of rendering literally", () => {
  const out = renderTemplate("Hey {{contact.first_name}}!", { contact: { first_name: "Alice" } });
  assert.equal(out, "Hey Alice!");
  assert.ok(!out.includes("{{"), "no braces may survive into an outbound body");
});

test("REGRESSION: the real AI-SET-03 copy renders end to end", () => {
  const body = "Hey {{contact.first_name}}, it's Chris from FundHub! You've been pre-approved for {{contact.analyzer_prequal_amount}} in capital. {{user.name}} will take it from here!";
  const out = renderTemplate(body, {
    contact: { first_name: "Dana", analyzer_prequal_amount: "$50,000" },
    user: { name: "Chris" }
  });
  assert.equal(out, "Hey Dana, it's Chris from FundHub! You've been pre-approved for $50,000 in capital. Chris will take it from here!");
});

test("dotted tags tolerate whitespace inside the braces", () => {
  assert.equal(renderTemplate("Hi {{ contact.first_name }}.", { contact: { first_name: "Bob" } }), "Hi Bob.");
});

test("deep paths resolve at any depth", () => {
  assert.equal(renderTemplate("{{a.b.c}}", { a: { b: { c: "deep" } } }), "deep");
});

test("unknown dotted token becomes empty string, never literal braces", () => {
  assert.equal(renderTemplate("Hi {{contact.first_name}}.", {}), "Hi .");
  assert.equal(renderTemplate("Hi {{contact.nope}}.", { contact: { first_name: "A" } }), "Hi .");
});

test("a missing intermediate segment does not throw", () => {
  assert.equal(renderTemplate("{{a.b.c}}", { a: null }), "");
  assert.equal(renderTemplate("{{a.b.c}}", { a: { b: "not-an-object" } }), "");
});

test("null leaf on a dotted path renders empty", () => {
  assert.equal(renderTemplate("Name: {{contact.first_name}}", { contact: { first_name: null } }), "Name: ");
});

test("a flat key that literally contains a dot still wins", () => {
  assert.equal(renderTemplate("{{contact.first_name}}", { "contact.first_name": "Flat" }), "Flat");
});

test("a partial path renders empty rather than sending [object Object]", () => {
  assert.equal(renderTemplate("Hi {{contact}}", { contact: { first_name: "Alice" } }), "Hi ");
});

test("inherited properties are not reachable through a merge tag", () => {
  assert.equal(renderTemplate("{{contact.constructor}}", { contact: { first_name: "Alice" } }), "");
  assert.equal(renderTemplate("{{toString}}", {}), "");
});

test("flat tokens still work unchanged alongside dotted ones", () => {
  assert.equal(
    renderTemplate("{{greeting}} {{contact.first_name}}", { greeting: "Yo", contact: { first_name: "Alice" } }),
    "Yo Alice"
  );
});

test("null context does not throw", () => {
  assert.equal(renderTemplate("Hi {{contact.first_name}}.", null), "Hi .");
});

test("empty body passes through", () => {
  assert.equal(renderTemplate("", { foo: "bar" }), "");
});

const CONFIRM_WHERE_SNIPPET = `<table>
  <tr>
    <td>When</td>
    <td>{{appointment.start_time}}</td>
  </tr>
  <tr>
    <td style="border-top:1px solid #E4E4E7;">Where</td>
    <td style="border-top:1px solid #E4E4E7;">{{appointment.meeting_location}}</td>
  </tr>
</table>`;

test("stripEmptyWhereRow: drops the Where row when the location cell is empty", () => {
  const rendered = renderTemplate(CONFIRM_WHERE_SNIPPET, {
    appointment: { start_time: "Tue, Aug 25, 2026, 1:00 PM MST", meeting_location: null }
  });
  const out = stripEmptyWhereRow(rendered);
  assert.match(out, /When/);
  assert.match(out, /Tue, Aug 25/);
  assert.doesNotMatch(out, />\s*Where\s*</);
});

test("stripEmptyWhereRow: keeps the Where row when a join URL is present", () => {
  const rendered = renderTemplate(CONFIRM_WHERE_SNIPPET, {
    appointment: { start_time: "Tue, Aug 25, 2026, 1:00 PM MST", meeting_location: "https://meet.example.com/abc" }
  });
  const out = stripEmptyWhereRow(rendered);
  assert.match(out, />\s*Where\s*</);
  assert.match(out, /https:\/\/meet\.example\.com\/abc/);
});
