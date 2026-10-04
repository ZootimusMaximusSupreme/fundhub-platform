// The /roadmap sales page carries its own three-step checkout widget
// (owner-set 2026-09-27 — 1 info, 2 card, 3 soft pull):
// marketing/landing-pages/slo/slo-01-sales.html.
// These checks read the page source. They pin the owner decisions and the API
// contract in docs/journeys/slo-roadmap-widget-flow.md so a later edit cannot
// quietly undo them. The browser walk is a separate proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(HERE, "../../marketing/landing-pages/slo/slo-01-sales.html");
const html = fs.readFileSync(PAGE, "utf8");

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const widgetScript = inlineScripts.find((s) => s.includes("getElementById('fhw')")) || "";
/* Everything a visitor can read before a pull result: the page with scripts,
   styles and comments removed, and with the widget's post-result panes cut out. */
const visibleBeforeResult = html
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<div class="cfw-state" data-state="(?:repair|repair-done)"[\s\S]*?<\/div>\s*(?=<div class="cfw-state")/g, "");

test("every inline script on the sales page parses", () => {
  assert.ok(inlineScripts.length > 0);
  for (const code of inlineScripts) assert.doesNotThrow(() => new vm.Script(code));
});

test("the checkout is the widget on this page: no pay.html link, every CTA scrolls to it", () => {
  assert.doesNotMatch(html, /roadmap\/pay\.html/);
  assert.match(html, /<div class="fh-widget-slot" id="fh-cf-form">\s*<div class="cfw" id="fhw">/);
  assert.match(html, /<a class="btn fh-go-pay" href="#fh-order">/);
  assert.match(html, /var dest=w\|\|o;/, "CTAs scroll to the widget, falling back to the section");
});

test("the widget calls the four doors on fundhub.ai, absolute, since the page lives on apply.fundhub.ai", () => {
  assert.match(widgetScript, /var API='https:\/\/fundhub\.ai\/api\/public\/';/);
  for (const door of ["'slo-checkout'", "'slo-pull'", "'slo-status?ref='", "'slo-repair-checkout'"]) {
    assert.ok(widgetScript.includes(door), door);
  }
});

test("demo or live is read from the server, never decided by the page", () => {
  assert.match(widgetScript, /demo:b\.demo===true/);
  assert.match(widgetScript, /if\(b\.demo===true\)\{demoEl\.textContent/);
  assert.doesNotMatch(widgetScript, /SLO_DEMO_PAY/);
});

test("three steps, in this order: info, card, soft pull", () => {
  assert.match(html, /<form class="cfw-step s1 on"/);
  assert.match(html, /<form class="cfw-step s2"/);
  assert.match(html, /<form class="cfw-step s3"/);
  assert.ok(html.indexOf('<form class="cfw-step s1 on"') < html.indexOf('<form class="cfw-step s2"'));
  assert.ok(html.indexOf('<form class="cfw-step s2"') < html.indexOf('<form class="cfw-step s3"'));
});

test("buy box v2: a blue progress bar replaces the three tabs, no step words on screen (owner-set 2026-10-02)", () => {
  const widget = html.slice(html.indexOf('<div class="cfw" id="fhw">'), html.indexOf('<form class="cfw-step s1 on"'));
  assert.match(widget, /<div class="cfw-progress" data-progress role="progressbar" aria-label="Checkout progress" aria-valuemin="1" aria-valuemax="3" aria-valuenow="1" aria-valuetext="Step 1 of 3"><i><\/i><\/div>/);
  /* No visible "Step n of 3" words: the bar is the whole indicator. */
  assert.doesNotMatch(widget, />Step 1 of 3</);
  assert.match(html, /\.cfw-progress i\{display:block;height:100%;width:33\.333%;background:#188bf6;/);
  /* The tabs are gone: no step buttons, no tab note, no tab code. */
  assert.doesNotMatch(html, /data-tab="[123]"/);
  assert.doesNotMatch(html, /1 &middot; Info|2 &middot; Card|3 &middot; Soft pull/);
  assert.doesNotMatch(html, /data-tabnote|cfw-tabnote|cfw-steps/);
  for (const dead of ["paintTabs", "lockNote", "tabNote", "tabBar"]) assert.ok(!widgetScript.includes(dead), dead);
  /* go() moves the bar for every step shown, and keeps its tracking. */
  const go = widgetScript.slice(widgetScript.indexOf("function go(n){"), widgetScript.indexOf("function showPane("));
  assert.match(go, /progress\.firstChild\.style\.width=\(n\*100\/3\)\+'%';progress\.setAttribute\('aria-valuenow',n\);progress\.setAttribute\('aria-valuetext','Step '\+n\+' of 3'\);/);
  assert.doesNotMatch(go, /progress\.textContent/);
  assert.match(go, /if\(fhTab!==n\)\{fhTab=n;fht\('buybox_tab',\{tab:n\}\);\}/, "same event name, so before and after compare");
  /* Step 3 still never opens before the card is paid. */
  assert.match(go, /if\(n===3&&!\(order&&order\.locked\)\)return;/);
  /* The way back from the card step is still there. */
  assert.match(html, /<a class="cfw-back" href="#" data-back>Back to step 1<\/a>/);
  assert.match(widgetScript, /root\.querySelector\('\[data-back\]'\)\.addEventListener\('click',function\(e\)\{e\.preventDefault\(\);go\(1\);\}\);/);
  /* Hidden while a status pane shows, and on the paid-return first paint. */
  assert.match(widgetScript, /progress\.hidden=!form;/);
  assert.match(html, /\.fh-paid \.cfw-progress,\.fh-paid \.cfw-step\{display:none!important\}/);
});

test("buy box v2: step 1 — the refund line right above the button, the button, the line under it", () => {
  const step1 = html.slice(html.indexOf('<form class="cfw-step s1 on"'), html.indexOf('<form class="cfw-step s2"'));
  assert.match(step1,
    /<p class="cfw-refund">If you're not happy with what you get, email us within 7 days and we'll refund you\.<\/p>\s*<button type="submit" class="cfw-btn">Get My Funding Roadmap<\/button>\s*<div class="cfw-note">Your roadmap shows up in your portal today\.<\/div>/);
  assert.doesNotMatch(step1, />Continue</);
  assert.doesNotMatch(html, /Step 1 of 3\. Your card is next, then the short soft pull form\./);
  /* The button keeps its handler and its tracking event. */
  assert.match(widgetScript, /s1\.addEventListener\('submit',function\(e\)\{e\.preventDefault\(\);onContinue\(\);\}\);/);
  /* continue (Meta Lead via the shared tracker) only after the step-1 checks pass:
     a failed press sends validation_error, never continue. */
  assert.match(
    widgetScript,
    /function onContinue\(\)\{\n(?:\s*\/\*[^*]*\*\/\n)?\s*if\(order&&order\.locked\)\{go\(3\);return;\}\n\s*if\(!checkStep1\(\)\)\{var f=s1\.querySelector\('\.err'\);if\(f\)f\.focus\(\);return;\}\n(?:\s*\/\*[\s\S]*?\*\/\n)?\s*fht\('continue',\{step:1\}\);\n\s*var c=contact\(\);/
  );
  assert.equal((widgetScript.match(/fht\('continue'/g) || []).length, 1, "one continue send");
});

test("buy box v2: every buy box event carries bbv:2 (widget and sample previews)", () => {
  assert.match(widgetScript, /var BBV=2;\n\s*function fht\(e,p\)\{try\{p=p\|\|\{\};p\.bbv=BBV;/);
  const preview = inlineScripts.find((x) => x.includes("preview_opened")) || "";
  assert.match(preview, /function fht\(e,p\)\{try\{p=p\|\|\{\};p\.bbv=2;/);
  /* Meta's PreviewOpened is unchanged. */
  assert.match(preview, /fbq\('trackCustom','PreviewOpened',\{content_name:d\}\)/);
});

test("checkout:success sends payment_result with the order's ref, for Meta Purchase id purchase.<ref> (Phase 4)", () => {
  const at = widgetScript.indexOf("card.on('checkout:success'");
  const success = widgetScript.slice(at, widgetScript.indexOf("card.on('form:submission_error'", at));
  assert.match(success, /var pr=\{result:'success'\};if\(order&&order\.ref\)pr\.order_ref=String\(order\.ref\);\n\s*fht\('payment_result',pr\);\n\s*go\(3\);/);
  /* bbv still rides on it: fht adds it to every buy box event. */
  assert.match(widgetScript, /function fht\(e,p\)\{try\{p=p\|\|\{\};p\.bbv=BBV;/);
  /* The fails carry no ref. */
  assert.match(widgetScript, /fht\('payment_result',\{result:'fail',code:'card_declined'\}\);/);
  assert.match(widgetScript, /fht\('payment_result',\{result:'fail',code:'checkout_error'\}\);/);
});

test("the page sends Meta nothing itself except PreviewOpened: Lead, InitiateCheckout, Purchase come from the shared tracker", () => {
  const fbqCalls = [...html.matchAll(/fbq\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(fbqCalls, ["'trackCustom','PreviewOpened',{content_name:d}"]);
});

test("the guarantee is back in its old place, right before the FAQ, word for word (owner ask 2026-10-02)", () => {
  const g = html.indexOf('<section class="sect" data-fh-section="guarantee">');
  const faq = html.indexOf('<section class="sect" data-fh-section="faq">');
  assert.ok(g > 0 && faq > g, "guarantee section sits before the FAQ");
  assert.equal(html.slice(g, faq).split("<section").length - 1, 1, "nothing but the guarantee between them");
  assert.match(html.slice(g, faq), /<section class="sect" data-fh-section="guarantee"><div class="cardw">\s*<span class="kicker">The Guarantee<\/span>\s*<p>If you're not happy with what you get, email support@fundhub\.ai within 7 days and <b>you get the full \$147 back\.<\/b><\/p>\s*<\/div><a class="btn fh-go-pay" href="#fh-order">Get My Roadmap<\/a><\/section>/);
  /* The CTA is caught by the scroll-to-the-buy-box handler. */
  assert.match(html, /closest\('a\[href="#fh-order"\]'\)/);
  assert.match(html, /\.fh-root \.cardw\{/);
});

test("the words social and SSN appear nowhere a buyer can read before step 3", () => {
  /* Owner-set 2026-09-27: "on the primary page remove anything that says ssn
     or social. the first page." The field itself has to stay on step 3 — that
     IS the soft pull — but nothing before it may say the word. */
  const a = html.indexOf('<form class="cfw-step s3"');
  const b = html.indexOf("</form>", a) + "</form>".length;
  const strip = (x) => x
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ");
  for (const [where, chunk] of [["before step 3", html.slice(0, a)], ["after step 3", html.slice(b)]]) {
    const hit = strip(chunk).match(/\b(social|ssn)\b/i);
    assert.equal(hit, null, `"${hit?.[0]}" is readable ${where} — it belongs only on the soft pull step`);
  }
  /* and it is still asked where it has to be */
  assert.match(html.slice(a, b), /Social Security number/);
});

test("nothing about the credit file is asked before the card", () => {
  const upToCard = html.slice(0, html.indexOf('<form class="cfw-step s3"'));
  for (const field of ['name="ssn"', 'name="dob"', 'name="consent"', 'name="prev_address"']) {
    assert.ok(!upToCard.includes(field), `${field} must live on step 3, after the card`);
  }
  /* And they do all live on step 3. */
  const step3 = html.slice(html.indexOf('<form class="cfw-step s3"'));
  for (const field of ['name="ssn"', 'name="dob"', 'name="consent"', 'name="prev_address"']) {
    assert.ok(step3.includes(field), field);
  }
});

test("step 1 is contact only — businesses are the add-on on step 3", () => {
  const step1 = html.slice(html.indexOf('<form class="cfw-step s1 on"'), html.indexOf('<form class="cfw-step s2"'));
  assert.ok(!step1.includes("data-bizlist"), "no business block on step 1");
  assert.ok(!step1.includes("data-add"), "no Add a business button on step 1");
  /* Buy box v2 (owner-set 2026-10-02): first name, last name, email. That is all. */
  assert.deepEqual([...step1.matchAll(/<input[^>]*name="([^"]+)"/g)].map((m) => m[1]), ["c_first", "c_last", "email"]);

  const step3 = html.slice(html.indexOf('<form class="cfw-step s3"'));
  assert.match(step3, /<div data-bizlist><\/div>/);
  assert.match(step3, /data-add>\+ Add a business/);
  assert.match(step3, /Your first business is included\. Each extra one is \$15\./);
});

test("buy box v2: the phone moved to step 3, still required, and is sent with the soft pull", () => {
  const step3 = html.slice(html.indexOf('<form class="cfw-step s3"'));
  assert.match(step3, /<label>Phone<input type="tel" name="phone" data-f="phone" autocomplete="tel" inputmode="tel" maxlength="20"><\/label>/);
  /* before the consent that names "the number I gave" */
  assert.ok(step3.indexOf('name="phone"') < step3.indexOf('name="consent"'));
  const check3 = widgetScript.slice(widgetScript.indexOf("function checkStep3()"), widgetScript.indexOf("function identity()"));
  assert.match(check3, /if\(!squeeze\(ph\.value\)\)bad\(ph,'Please enter your phone number\.'\);/);
  assert.match(check3, /else if\(!phone10\(ph\.value\)\)bad\(ph,'Use a 10-digit phone number\.'\);/);
  assert.match(widgetScript, /phone:phone10\(val\(s3,'phone'\)\)\|\|val\(s3,'phone'\)\};/, "identity() carries it to slo-pull");
  /* Step 1 no longer checks or sends one. */
  const check1 = widgetScript.slice(widgetScript.indexOf("function checkStep1()"), widgetScript.indexOf("function contact()"));
  assert.doesNotMatch(check1, /phone/);
  assert.match(widgetScript, /var body=\{email:c\.email,first_name:c\.first_name,last_name:c\.last_name,return_url:returnUrl\(\)\};/);
});

test("the card charges the base price on its own — step 3 cannot change it", () => {
  assert.match(widgetScript, /function paintTotal\(\)\{\n\s*totalEl\.innerHTML='<s class="fh-was">\$297<\/s> '\+money\(price\.base\);/);
  assert.match(widgetScript, /payBtn\.textContent='Get My Roadmap · '\+money\(price\.base\);/);
  /* the extras get their own line on step 3, never the pay button */
  assert.match(widgetScript, /function paintExtras\(\)\{/);
  assert.match(html, /data-bizline hidden/);
});

test("step 2 takes the card on this page — Commas' own boxes, mounted here", () => {
  const step2 = html.slice(html.indexOf('<form class="cfw-step s2"'), html.indexOf('<form class="cfw-step s3"'));
  assert.match(step2, /<div class="cfw-cardmount" data-cardmount>/, "the card form has a home on step 2");
  assert.match(step2, /data-pay>Get My Roadmap/);
  /* Our own card <input>s are gone on purpose: Commas publishes no endpoint
     that accepts a card number, so ours could only ever be thrown away — and
     they were, after the buyer typed the card a second time on a Commas page. */
  for (const field of ['name="card_number"', 'name="card_exp"', 'name="card_cvc"', 'name="card_zip"']) {
    assert.ok(!step2.includes(field), `${field} must not be a Fundhub input`);
  }
  assert.match(widgetScript, /cdn\.embedded\.fanbasis\.io\/embed\/index\.js/, "the Commas embedded SDK is loaded");
  assert.match(widgetScript, /window\.PaymentCheckout\.create\(cfg\)/);
  assert.match(widgetScript, /card\.attachToElement\(cardMount\)/);
  assert.match(widgetScript, /showSubmitButton:false/, "our own button submits, so there is only one");
});

test("no card number is ever posted to Fundhub", () => {
  /* The only bodies this widget sends are the four documented doors. If a card
     field name ever turns up in the script again, something is collecting one. */
  for (const bad of ["card_number", "card_exp", "card_cvc", "card_zip", "cc-number", "cc-csc"]) {
    assert.ok(!widgetScript.includes(bad), `${bad} must not appear in the widget script`);
  }
});

test("step 2 pays and nothing else: no defer_pull, and the pull is never sent with the card", () => {
  assert.doesNotMatch(widgetScript, /defer_pull/, "the pull is never deferred now — the card comes first");
  const step2 = widgetScript.slice(
    widgetScript.indexOf("s2.addEventListener('submit'"),
    widgetScript.indexOf("s3.addEventListener('submit'")
  );
  assert.ok(step2.length > 0, "both submit handlers exist, step 2 before step 3");
  assert.ok(!step2.includes("sendPull"), "step 2 must not start the pull");
  assert.match(step2, /card\.submitForm\(\)/, "the typed card is charged in place");
  assert.match(step2, /if\(order&&order\.demo\)\{order\.locked=true;go\(3\);return;\}/, "demo takes no card, so it walks to step 3");
});

test("paying never navigates away — no hosted Commas page anywhere on step 2", () => {
  /* The owner law (2026-09-29): the buyer types the card on /roadmap. The
     hosted payment_link is still minted server-side for the webhook to match
     against, but this page must never send anybody to it. */
  assert.ok(!widgetScript.includes("location.href=o.checkoutUrl"), "the old redirect is gone");
  assert.ok(!/location\.href\s*=\s*[^;]*checkoutUrl/.test(
    widgetScript.slice(widgetScript.indexOf("function beginCard"), widgetScript.indexOf("s3.addEventListener('submit'"))
  ), "step 2 sets no location.href from a checkout URL");
  assert.doesNotMatch(widgetScript, /location\.href\s*=\s*['"]https:\/\/(?:www\.)?(?:fanbasis|commas)\./i);
  /* Success is an event on the embedded form, and it opens step 3 right here. */
  assert.match(widgetScript, /card\.on\('checkout:success'/);
  assert.match(widgetScript, /card\.on\('form:submission_error'/, "a decline shows Commas' words on our page");
});

test("a paid buyer is never bounced back to step 1 by the unpaid-order gate", () => {
  /* The gate answers existing_account only while the order still reads unpaid.
     After the card that is a timing gap, not a dead end. */
  assert.match(
    widgetScript,
    /if\(b\.error==='existing_account'&&o\.locked\)\{\n\s*showFormErr\('Your payment is still landing on our side\./
  );
});

test("step 3 runs the pull, and the paid return opens step 3", () => {
  const step3 = widgetScript.slice(widgetScript.indexOf("s3.addEventListener('submit'"));
  assert.match(step3, /sendPull\(order,bizPayload\(\)\)/);
  assert.match(step3, /checkStep3\(\)/);
  /* ?ref=&client_id= back from the card page lands on the soft pull form. */
  assert.match(widgetScript, /showPane\('form'\);go\(3\);/);
  assert.match(html, /\.fh-paid \.cfw-step\.s3\{display:block!important\}/);
  /* The webhook may not have landed yet: wait on the poll, never re-charge. */
  assert.match(widgetScript, /if\(b\.next==='pay'\)\{o\.locked=true;showPane\('reading'\);poll\(o\);return;\}/);
});

test("the consent box uses the pull form's words, and covers texts too", () => {
  assert.match(html, /name="consent"/);
  assert.match(html, /I authorize Fundhub LLC to run a soft pull of my credit report\. A soft pull does not affect my credit score\./);
  /* Owner-set 2026-09-27: the soft pull agreement also carries the texting
     agreement, so the box a person ticks has to say so. The words the ROW
     stores are the server's (soft-pull-v3, "Fundhub LLC", owner-set 2026-10-02) — src/consent/disclosures.test.mjs
     holds those. This only holds what the screen shows. */
  assert.match(html, /I also agree Fundhub LLC may call and text me at the number I gave, including automated texts, about my file\./);
  assert.match(html, /Message and data rates may apply\. Reply STOP to stop\./);
  assert.match(html, /Agreeing to texts is not a condition of buying anything\./);
});

test("prices: first business free, each extra from the server (default 1500 cents)", () => {
  assert.match(widgetScript, /var price=\{base:14700,each:1500,max:20\};/);
  assert.match(widgetScript, /extra=price\.each\*\(n-1\)/);
  assert.match(html, /\+ Add a business \(\$15\)/);
});

test("no repair or letter-mailing words are visible before a pull result", () => {
  assert.doesNotMatch(visibleBeforeResult, /repair/i);
  assert.doesNotMatch(visibleBeforeResult, /mails? (?:your|my) letters|letter mailing|order bump/i);
});

test("the social and date of birth never reach storage, the console or the address bar", () => {
  const lines = widgetScript.split("\n");
  for (const line of lines) {
    if (/sessionStorage|localStorage|document\.cookie/.test(line)) {
      assert.doesNotMatch(line, /ssn|dob/i, line.trim());
    }
    if (/console\./.test(line)) assert.doesNotMatch(line, /ssn|dob/i, line.trim());
    if (/URLSearchParams\(\)|q\.set\(/.test(line)) assert.doesNotMatch(line, /ssn|dob/i, line.trim());
  }
  assert.match(html, /name="ssn" class="mask"[^>]*autocomplete="off"/);
});

test("after the pull: time-to-bucket is logged, funding goes to the booking page with pa", () => {
  assert.match(widgetScript, /console\.info\('fh-widget time-to-bucket '/);
  assert.match(widgetScript, /var BOOK='https:\/\/apply\.fundhub\.ai\/roadmap-book';/);
  assert.match(widgetScript, /q\.set\('pa',String\(n\)\)/);
  assert.match(widgetScript, /POLL_MS=1000,POLL_MAX_MS=90000/);
});

/* ── 2026-09-22 review ─────────────────────────────────────────────────────── */

/* Pull one named function out of the widget script, by brace matching, so it
   can run on its own in a sandbox. */
function widgetFunction(name) {
  const start = widgetScript.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} is in the widget`);
  let depth = 0;
  for (let i = widgetScript.indexOf("{", start); i < widgetScript.length; i++) {
    if (widgetScript[i] === "{") depth += 1;
    else if (widgetScript[i] === "}") { depth -= 1; if (depth === 0) return widgetScript.slice(start, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

function runWidgetCheck(fields) {
  /* checkAddress with its real helpers, over plain objects standing in for inputs. */
  const code = [widgetFunction("squeeze"), widgetFunction("plain"), widgetFunction("normApt"),
    widgetScript.match(/var PO=.*?;/)[0], widgetFunction("checkAddress")].join("\n");
  const bad = [];
  const warn = [];
  const ctx = vm.createContext({ setErr: (el, msg, w) => { if (w) warn.push([el.k, msg]); }, String, JSON });
  vm.runInContext(`${code}\nthis.checkAddress = checkAddress;`, ctx);
  const inputs = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { k, value: v }]));
  ctx.checkAddress((k) => inputs[k], "your", (el, msg) => bad.push([el.k, msg]));
  return { bad, warn };
}

test("items 4-5: the widget's street and apartment rules match the server", () => {
  const base = { apt: "", city: "Town", state: "TX", zip: "76205" };
  for (const street of ["PSC 1234 Box 5678", "Unit 2050 Box 4190", "CMR 480 Box 123", "Calle Luna 55",
    "Urb Las Gladiolas 150 Calle A", "N7450 Aanstad Rd", "100 Main St"]) {
    const out = runWidgetCheck({ ...base, address: street });
    assert.deepEqual(out.bad, [], street);
    assert.deepEqual(out.warn, [], street);
  }
  assert.equal(runWidgetCheck({ ...base, address: "Main St" }).bad[0][0], "address", "a street needs a digit somewhere");
  assert.equal(runWidgetCheck({ ...base, address: "1A" }).bad[0][0], "address", "3 characters at least");
  assert.equal(runWidgetCheck({ ...base, address: "PO Box 12" }).warn[0][0], "address", "a P.O. box warns");
  assert.deepEqual(runWidgetCheck({ ...base, address: "PO Box 12" }).bad, []);
  for (const apt of ["Apt. 4B", "Ste. 200", "#12", "# 12"]) {
    assert.deepEqual(runWidgetCheck({ ...base, address: "100 Main St", apt }).bad, [], apt);
  }
  const long = runWidgetCheck({ ...base, address: "100 Main St", apt: "Apartment 12B" }).bad[0];
  assert.equal(long[0], "apt");
  assert.match(long[1], /10 characters or fewer/);
  assert.doesNotMatch(widgetScript, /Start with the house number/);
  assert.doesNotMatch(widgetScript, /RURAL/);
  assert.match(html, /name="apt" data-f="apt" autocomplete="address-line2" maxlength="14"/, "the box takes 'Apt. 4B'-style typing");
});

test("item 6: no 18+ rule in the widget", () => {
  assert.doesNotMatch(widgetScript, /18 or older/);
  assert.doesNotMatch(widgetScript, /age<18/);
  const code = [widgetFunction("squeeze"), widgetFunction("parseDob"), widgetFunction("vDob")].join("\n");
  const ctx = vm.createContext({ Date, String });
  vm.runInContext(`${code}\nthis.vDob = vDob;`, ctx);
  assert.equal(ctx.vDob("01/02/2015"), null, "a child's date is a real date");
  assert.equal(ctx.vDob("02/31/1990"), "That date is not a real date. Please check it.");
  assert.equal(ctx.vDob("01/01/1899"), "That date is not a real date. Please check it.");
  assert.equal(ctx.vDob("01/01/2999"), "That date is in the future. Please check it.");
});

test("item 9: 'We couldn't find that address' goes under the street box; Start My Soft Pull again confirms it", () => {
  assert.match(widgetScript, /var ADDR_MSG="We couldn't find that address\. Check the street and ZIP, or tap Start My Soft Pull again to use it as typed\.";/);
  assert.match(widgetScript, /if\(b\.error==='address_unverified'\)\{\s*addrWarned=addrSig\(\);/);
  assert.match(widgetScript, /if\(addrWarned&&addrWarned===addrSig\(\)\)body\.address_confirmed=true;/);
  assert.match(widgetScript, /setErr\(st,ADDR_MSG,true\)/, "shown as a warning, not an error");
});

test("item 10: Google autocomplete loads only when the server hands a browser key", () => {
  assert.doesNotMatch(html, /<script[^>]+src="https:\/\/maps\.googleapis\.com/i, "no static Google script on the page");
  assert.match(widgetScript, /if\(b\.mapsBrowserKey\)placesInit\(b\.mapsBrowserKey\);/);

  const appended = [];
  const ctx = vm.createContext({
    window: {},
    document: {
      createElement: (tag) => ({ tag }),
      head: { appendChild: (el) => { appended.push(el); } }
    },
    s3: { querySelectorAll: () => [], querySelector: () => null },
    each: () => {},
    encodeURIComponent,
    placesAttach: () => { throw new Error("must not attach without Google loaded"); }
  });
  vm.runInContext(`${widgetFunction("placesInit")}\nthis.placesInit = placesInit;`, ctx);

  for (const key of [null, undefined, "", 0]) {
    assert.equal(ctx.placesInit(key), false, String(key));
  }
  assert.equal(appended.length, 0, "null key: nothing loads");
  assert.equal(ctx.window.fhwPlacesReady, undefined);

  assert.equal(ctx.placesInit("browser key/1"), true);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].tag, "script");
  assert.equal(
    appended[0].src,
    "https://maps.googleapis.com/maps/api/js?key=browser%20key%2F1&libraries=places&callback=fhwPlacesReady"
  );
  assert.equal(typeof ctx.window.fhwPlacesReady, "function");
  assert.equal(typeof ctx.window.gm_authFailure, "function", "a refused key re-enables the boxes");
});

test("item 10: a picked place fills street, city, state and ZIP (US only)", () => {
  assert.match(widgetScript, /componentRestrictions:\{country:placesCountries\}/);
  assert.match(widgetScript, /var placesCountries=\['us','pr','vi','gu','mp'\];/);
  const boxes = {};
  const sel = { value: "", querySelector: (q) => (/value="TX"|value="PR"/.test(q) ? {} : null) };
  const ctx = vm.createContext({
    s3: { querySelector: (q) => {
      const name = q.match(/name="([^"]+)"/)[1];
      if (/state$/.test(name)) return sel;
      return (boxes[name] = boxes[name] || { value: "" });
    } },
    clearErr: () => {},
    String
  });
  vm.runInContext(`${widgetFunction("squeeze")}\n${widgetFunction("placeFill")}\nthis.placeFill = placeFill;`, ctx);
  ctx.placeFill("", { address_components: [
    { types: ["street_number"], long_name: "100", short_name: "100" },
    { types: ["route"], long_name: "Main Street", short_name: "Main St" },
    { types: ["locality"], long_name: "Denton", short_name: "Denton" },
    { types: ["administrative_area_level_1"], long_name: "Texas", short_name: "TX" },
    { types: ["country"], long_name: "United States", short_name: "US" },
    { types: ["postal_code"], long_name: "76205", short_name: "76205" }
  ] });
  assert.equal(boxes.address.value, "100 Main Street");
  assert.equal(boxes.city.value, "Denton");
  assert.equal(sel.value, "TX");
  assert.equal(boxes.zip.value, "76205");
});

test("item 8: the lander never offers done-for-you; the Dispute Letter Pack copy stays", () => {
  assert.doesNotMatch(html, /Credits toward your deposit if you ever go done-for-you/);
  assert.doesNotMatch(html, /your \$297 counts toward it/);
  assert.doesNotMatch(html, /If you'd rather we run it, you'll see that option after checkout/);
  /* Rewritten 2026-09-29 (roadmap reorder, owner-approved): the answer now says
     "No" outright. Still do-it-yourself, still no done-for-you offer. */
  assert.match(html, /<summary>Can you do the work for me\?<\/summary><div class="a">No\. This is do-it-yourself\. You mail your own letters, so you hold every receipt and see every reply\.<\/div>/);
  assert.match(html, /Zero score impact from that pull<\/div>/);
  assert.match(html, /Print\. Sign\. Mail\./);
});
