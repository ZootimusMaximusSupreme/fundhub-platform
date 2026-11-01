/* Homepage multi-step survey — CF ground truth + OWNER attribute keys.
   marketing/landing-pages/clickfunnels/cf-survey-ground-truth.md
   marketing/landing-pages/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md
   Contact LAST. Business name optional. */
(function () {
  var PERSONAL = "No, personal funding only";

  /* Funnel tracking (docs/tracking/tracking-spec.md). Sends the screen id, the field NAME
     and a short error code. Never an answer, never typed text. Safe before
     /funnel/fh-events.js loads: it drains window.fhq. */
  function fht(e, p) {
    (window.fhTrack || function (e, p) { (window.fhq = window.fhq || []).push([e, p]); })(e, p);
  }

  var STEPS = [
    {
      id: "funding_target_amount",
      title: "Set Your Target Amount",
      type: "single",
      options: [
        "Less than $50k",
        "$50k - $100k",
        "$100k - $200k",
        "$200k - $400k",
        "$400k+",
      ],
    },
    {
      id: "planned_use",
      title: "Planned Use",
      type: "single",
      otherEnabled: true,
      options: [
        "Growth (marketing, inventory, hiring)",
        "Equipment or buildout",
        "Debt consolidation",
        "Payroll or rent",
        "Covering a shortfall right now",
        "Not sure yet",
        "Other",
      ],
    },
    {
      id: "money_change_now",
      title: "What Would This Money Change Right Now?",
      subtitle: "Select all that apply.",
      type: "multi",
      options: [
        "Peace of mind (stop stressing about cash)",
        "Grow faster (more customers / more reach)",
        "Pay off pressure (wipe out high-interest debt)",
        "Stability (cover bills / buffer slow weeks)",
        "Fresh start (new business / startup launch)",
      ],
    },
    {
      id: "current_score",
      title: "Your Current Score",
      type: "single",
      // Owner-set score ranges (2026-10-31), same as the /apply survey.
      options: ["500-619", "620-699", "700-759", "760-850", "Not sure"],
    },
    {
      id: "has_negatives",
      title: "Any negatives on your credit report?",
      type: "single",
      options: ["Yes", "No"],
    },
    {
      id: "has_business",
      title: "Do You Have a Business?",
      type: "single",
      options: [
        "Yes, less than 6 months old",
        "Yes, 6-12 months",
        "Yes, 1-2 years",
        "Yes, 2-5 years",
        "Yes, 5+ years",
        PERSONAL,
      ],
    },
    {
      id: "annual_business_revenue",
      title: "Annual Business Revenue",
      type: "single",
      branch: "business",
      options: [
        "Under $100k",
        "$100k - $249k",
        "$250k - $499k",
        "$500k - $999k",
        "$1M+",
      ],
    },
    {
      id: "verify_revenue",
      title: "Can You Verify Revenue?",
      type: "single",
      branch: "business",
      options: [
        "Yes, bank statements",
        "Yes, tax returns",
        "Yes, both",
        "Not right now",
      ],
    },
    {
      id: "annual_personal_income",
      title: "Annual Personal Income",
      type: "single",
      branch: "personal",
      options: [
        "Less than $50k",
        "$50k-$99k",
        "$100k-$199k",
        "$200k-$499k",
        "$500k+",
      ],
    },
    {
      id: "verify_income",
      title: "Can You Verify Income?",
      type: "single",
      branch: "personal",
      options: [
        "Yes, pay stubs",
        "Yes, W-2 or tax returns",
        "Yes, both",
        "Not right now",
      ],
    },
    {
      id: "available_capital",
      title: "Available Capital",
      type: "single",
      options: [
        "Less than $1k",
        "$1k - $5k",
        "$5k - $25k",
        "$25k - $100k",
        "$100k+",
      ],
    },
    {
      id: "contact",
      title: "Let's Start With Your Info",
      subtitle: "Tell us how to reach you. Soft inquiry. No obligation.",
      type: "contact",
    },
  ];

  // Keep in sync with src/survey/cf-question-map.mjs payloadKey
  var PAYLOAD_KEY = {
    funding_target_amount: "cf_svy_funding_target_amount",
    planned_use: "cf_svy_planned_use",
    money_change_now: "cf_svy_money_change_now",
    current_score: "cf_svy_self_reported_fico",
    has_negatives: "cf_svy_has_negatives",
    has_business: "cf_svy_has_business",
    annual_business_revenue: "cf_svy_business_revenue",
    verify_revenue: "cf_svy_revenue_verifiable",
    annual_personal_income: "cf_svy_annual_income_range",
    verify_income: "cf_svy_income_verifiable",
    available_capital: "cf_svy_available_capital",
  };

  function visibleSteps(answers) {
    var biz = answers.has_business;
    var onPersonal = biz === PERSONAL;
    var onBusiness = typeof biz === "string" && biz.indexOf("Yes") === 0;
    return STEPS.filter(function (s) {
      if (!s.branch) return true;
      if (s.branch === "business") return onBusiness;
      if (s.branch === "personal") return onPersonal;
      return true;
    });
  }

  function toPayloadAnswers(answers) {
    var out = {};
    Object.keys(answers).forEach(function (id) {
      var key = PAYLOAD_KEY[id];
      if (!key) return;
      var v = answers[id];
      if (v == null || v === "") return;
      out[key] = v;
    });
    return out;
  }

  function init() {
    var root = document.getElementById("appform");
    if (!root) return;

    var answers = {};
    var idx = 0;
    var multiPick = {};
    var otherText = "";
    var lastSent = false;

    function steps() {
      return visibleSteps(answers);
    }

    function setErr(msg) {
      var el = root.querySelector(".sv-err");
      if (el) el.textContent = msg || "";
    }

    var fhSent = {};
    /* field_focus / field_complete: once per field per page load. */
    function fhField(event, field) {
      if (fhSent[event + ":" + field]) return;
      fhSent[event + ":" + field] = 1;
      fht(event, { form: "home", field: field });
    }
    function fhInvalid(field, code) {
      fht("validation_error", { form: "home", field: field, code: code });
    }
    /* The same checks submitForm makes. Business and phone are optional: any value counts. */
    function fieldOk(field, v) {
      v = String(v || "").trim();
      if (field === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      return !!v;
    }
    function trackField(el) {
      if (!el) return;
      var field = el.name;
      el.addEventListener("focus", function () {
        fhField("field_focus", field);
      });
      el.addEventListener("input", function () {
        fhField("field_focus", field);
      });
      el.addEventListener("blur", function () {
        if (fieldOk(field, el.value)) fhField("field_complete", field);
      });
    }

    function render() {
      var list = steps();
      if (idx < 0) idx = 0;
      if (idx >= list.length) idx = list.length - 1;
      var step = list[idx];
      var pct = Math.round(((idx + 1) / list.length) * 100);

      var html =
        '<div class="sv-progress" aria-hidden="true"><i style="width:' +
        pct +
        '%"></i></div>' +
        '<div class="sv-meta"><span>Step ' +
        (idx + 1) +
        " of " +
        list.length +
        "</span></div>" +
        '<div class="sv-q">' +
        step.title +
        "</div>" +
        (step.subtitle ? '<div class="sv-sub">' + step.subtitle + "</div>" : "");

      if (step.type === "contact") {
        html +=
          '<div class="field"><label for="sv-name">Full name</label>' +
          '<input type="text" id="sv-name" name="name" autocomplete="name" placeholder="First and last" required></div>' +
          '<div class="field"><label for="sv-business">Business name <span style="text-transform:none;letter-spacing:0;color:var(--gray2)">(optional)</span></label>' +
          '<input type="text" id="sv-business" name="business" autocomplete="organization" placeholder="As registered"></div>' +
          '<div class="field"><label for="sv-email">Email address</label>' +
          '<input type="email" id="sv-email" name="email" autocomplete="email" placeholder="you@company.com" required></div>' +
          '<div class="field"><label for="sv-phone">Mobile (for text updates) <span style="text-transform:none;letter-spacing:0;color:var(--gray2)">(optional)</span></label>' +
          '<input type="tel" id="sv-phone" name="phone" autocomplete="tel" placeholder="(555) 555-5555"></div>' +
          '<div class="consent"><input type="checkbox" id="sv-sms" name="sms_consent">' +
          '<label for="sv-sms">I agree to receive SMS from Fundhub.ai about my funding application. Msg &amp; data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help. See our <a href="/privacy/">Privacy Policy</a> and <a href="/terms/">Terms</a>.</label></div>' +
          '<p class="sv-err" role="alert"></p>' +
          '<div class="sv-nav">' +
          (idx > 0
            ? '<button type="button" class="btn btn-ghost" data-act="back">Back</button>'
            : "") +
          '<button type="button" class="btn" data-act="submit">Submit application</button></div>' +
          '<p class="disclaim">By submitting, you confirm the information provided is accurate and that you are the subscriber or authorized user of the phone number entered. Fundhub is not a direct lender and does not guarantee approval or specific terms.</p>';
      } else {
        var selected = answers[step.id];
        var picked = multiPick[step.id] || {};
        html +=
          '<div class="sv-opts" role="listbox" aria-label="' +
          step.title.replace(/"/g, "") +
          '">';
        (step.options || []).forEach(function (opt) {
          var on = step.type === "multi" ? !!picked[opt] : selected === opt;
          // data-fh-track: the shared tracker labels this press "click:home-option", never the answer words.
          html +=
            '<button type="button" class="sv-opt' +
            (on ? " on" : "") +
            '" data-fh-track="home-option" data-opt="' +
            opt.replace(/"/g, "&quot;") +
            '">' +
            opt +
            "</button>";
        });
        html += "</div>";
        if (step.otherEnabled && selected === "Other") {
          html +=
            '<div class="field" style="margin-top:8px"><label for="sv-other">Other</label>' +
            '<input type="text" id="sv-other" value="' +
            String(otherText || "").replace(/"/g, "&quot;") +
            '"></div>';
        }
        html += '<p class="sv-err" role="alert"></p>';
        html += '<div class="sv-nav">';
        if (idx > 0)
          html +=
            '<button type="button" class="btn btn-ghost" data-act="back">Back</button>';
        html +=
          '<button type="button" class="btn" data-act="next">Next</button></div>';
      }

      root.innerHTML = html;
      bind(step);
    }

    function bind(step) {
      root.querySelectorAll(".sv-opt").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var val = btn.getAttribute("data-opt");
          if (step.type === "multi") {
            multiPick[step.id] = multiPick[step.id] || {};
            multiPick[step.id][val] = !multiPick[step.id][val];
            render();
          } else {
            answers[step.id] = val;
            render();
          }
        });
      });
      var otherInput = document.getElementById("sv-other");
      if (otherInput) {
        otherInput.addEventListener("input", function () {
          otherText = otherInput.value;
        });
      }
      var back = root.querySelector('[data-act="back"]');
      if (back)
        back.addEventListener("click", function () {
          idx -= 1;
          setErr("");
          render();
        });
      var next = root.querySelector('[data-act="next"]');
      if (next)
        next.addEventListener("click", function () {
          if (step.type === "multi") {
            var picks = Object.keys(multiPick[step.id] || {}).filter(function (
              k
            ) {
              return multiPick[step.id][k];
            });
            if (!picks.length) {
              setErr("We need this one to continue.");
              fhInvalid(step.id, "required");
              return;
            }
            answers[step.id] = picks;
          } else if (!answers[step.id]) {
            setErr("We need this one to continue.");
            fhInvalid(step.id, "required");
            return;
          } else if (step.otherEnabled && answers[step.id] === "Other") {
            var ot = (document.getElementById("sv-other") || {}).value || "";
            ot = String(ot).trim();
            if (!ot) {
              setErr("We need this one to continue.");
              fhInvalid(step.id, "other_required");
              return;
            }
            otherText = ot;
            answers[step.id] = ot;
          }
          // step_num: where this screen sat on the path this visitor saw.
          fht("survey_answer", { survey: "home", step_num: idx + 1, question_id: step.id });
          if (step.id === "has_business") {
            if (answers[step.id] === PERSONAL) {
              delete answers.annual_business_revenue;
              delete answers.verify_revenue;
            } else {
              delete answers.annual_personal_income;
              delete answers.verify_income;
            }
          }
          idx += 1;
          setErr("");
          render();
        });
      var submit = root.querySelector('[data-act="submit"]');
      if (submit)
        submit.addEventListener("click", function () {
          submitForm(submit);
        });
      if (step.type === "contact") {
        ["sv-name", "sv-business", "sv-email", "sv-phone"].forEach(function (id) {
          trackField(document.getElementById(id));
        });
      }
    }

    function submitForm(btn) {
      var name = (document.getElementById("sv-name") || {}).value || "";
      var email = (document.getElementById("sv-email") || {}).value || "";
      var phone = (document.getElementById("sv-phone") || {}).value || "";
      var business = (document.getElementById("sv-business") || {}).value || "";
      var sms = !!(document.getElementById("sv-sms") || {}).checked;
      name = String(name).trim();
      email = String(email).trim();
      phone = String(phone).trim();
      business = String(business).trim();
      if (!name) {
        setErr("We need this one to continue.");
        fhInvalid("name", "required");
        return;
      }
      if (!email) {
        setErr("We need this one to continue.");
        fhInvalid("email", "required");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setErr("That address doesn't look complete — check for a typo.");
        fhInvalid("email", "invalid");
        return;
      }
      // Autofill can fill a field without a blur: a field that passed counts as complete.
      [["name", name], ["business", business], ["email", email], ["phone", phone]].forEach(function (f) {
        if (fieldOk(f[0], f[1])) fhField("field_complete", f[0]);
      });
      var list = steps();
      // last: the final question (contact, step 10). The shared tracker turns it into
      // Meta Lead (docs/tracking/meta-events.md, Phase 4 map). Once per page load, so a
      // second press after a failed send is not a second Lead.
      var answer = { survey: "home", step_num: idx + 1, question_id: list[idx].id };
      if (!lastSent) answer.last = true;
      lastSent = true;
      fht("survey_answer", answer);
      btn.disabled = true;
      btn.textContent = "Sending…";
      setErr("");

      fetch("/api/public/survey-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone,
          business: business,
          sms_consent: sms,
          source: "website:home",
          answers: toPayloadAnswers(answers),
          answers_by_id: answers,
          page_url: location.href,
          submitted_at: new Date().toISOString(),
        }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, status: r.status, body: j };
          });
        })
        .then(function (res) {
          if (!res.ok || !res.body || !res.body.redirect) {
            btn.disabled = false;
            btn.textContent = "Submit application";
            setErr(
              "That didn't go through. Try once more, or email support@fundhub.ai."
            );
            return;
          }
          if (res.body.deduped) {
            btn.disabled = false;
            btn.textContent = "Submit application";
            setErr(
              "We already have this one. Your advisor will reach out shortly."
            );
            return;
          }
          btn.textContent = "Received";
          window.location.assign(res.body.redirect);
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = "Submit application";
          setErr(
            "That didn't go through. Try once more, or email support@fundhub.ai."
          );
        });
    }

    root.addEventListener("submit", function (e) {
      e.preventDefault();
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
