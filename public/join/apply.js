// The hiring funnel application — shared by /join/apply/ (setter, closer, CSM)
// and /join/coo/apply/ (COO). Each page carries its own hero copy and its own
// script#fh-join-survey block (pageSurvey("sales") or pageSurvey("coo") from
// src/hiring/survey.mjs); this file reads that block and runs the steps.
// A page with one seat skips the seat step.
(function () {
  var S = JSON.parse(document.getElementById('fh-join-survey').textContent);
  var ENDPOINT = "/api/hiring/apply";
  var ROLE_KEYS = S.roles.map(function (r) { return r.key; });
  var state = { role: null, contact: {}, answers: {}, reference: {}, loom: '' };
  var at = 0;
  /* One seat on the page (the COO funnel): that seat is the answer, and there
     is no seat step to show. */
  var SINGLE = S.roles.length === 1;
  if (SINGLE) state.role = S.roles[0].key;

  var preset = new URLSearchParams(location.search).get('role');
  if (!SINGLE && preset && ROLE_KEYS.indexOf(preset) > -1) { state.role = preset; at = 1; }

  var body = document.getElementById('body');

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function roleOf(key) { for (var i = 0; i < S.roles.length; i++) if (S.roles[i].key === key) return S.roles[i]; return null; }
  function questions() { return S.questions.filter(function (q) { return state.role && q.roles.indexOf(state.role) > -1; }); }
  function steps() {
    var out = SINGLE ? [{ type: 'contact' }] : [{ type: 'role' }, { type: 'contact' }];
    questions().forEach(function (q) { out.push({ type: 'q', q: q }); });
    out.push({ type: 'reference' });
    out.push({ type: 'loom' });
    return out;
  }
  function stepIndex(type) {
    var list = steps();
    for (var i = 0; i < list.length; i++) if (list[i].type === type) return i;
    return -1;
  }
  /* Who the applicant meets. Owner-set 2026-10-13: the COO books with Chris. */
  function meets() { return state.role === 'coo' ? 'Chris, our CEO' : 'our sales manager'; }

  function render() {
    var list = steps(), st = list[at];
    var pct = Math.round(at / list.length * 90);
    document.getElementById('bar').style.width = Math.max(pct, 4) + '%';
    document.getElementById('count').innerHTML = '<b>' + pct + '%</b> · Step ' + (at + 1) + ' of ' + list.length;
    document.getElementById('back').hidden = at === 0;
    var h = '<div class="q">';
    if (st.type === 'role') {
      h += '<h2>Which Seat Are You Applying For?</h2><p class="hint">Pick one. You can apply for another seat after.</p><div class="opts" role="radiogroup">';
      S.roles.forEach(function (r) {
        h += '<button type="button" class="opt" role="radio" aria-checked="' + (state.role === r.key) + '" data-role="' + esc(r.key) + '"><span class="mk"></span><span class="tx">' + esc(r.label) + '<small>' + esc(r.blurb) + '</small></span></button>';
      });
      h += '</div>';
    } else if (st.type === 'contact') {
      var c = state.contact;
      h += '<h2>Your Info</h2><p class="hint">So ' + esc(meets()) + ' knows who they’re meeting.</p>' +
        '<div class="fields"><div class="half">' +
        '<div><label for="f-first">First name</label><input type="text" id="f-first" autocomplete="given-name" maxlength="60" value="' + esc(c.first || '') + '"></div>' +
        '<div><label for="f-last">Last name</label><input type="text" id="f-last" autocomplete="family-name" maxlength="60" value="' + esc(c.last || '') + '"></div></div>' +
        '<div><label for="f-email">Email</label><input type="email" id="f-email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="160" value="' + esc(c.email || '') + '"></div>' +
        '<div><label for="f-phone">Phone number</label><input type="tel" id="f-phone" autocomplete="tel" inputmode="tel" placeholder="(555) 555-5555" maxlength="14" value="' + esc(c.phone || '') + '"><div class="fieldnote">Only used to set up your interview.</div></div>' +
        '<div><label for="f-linkedin">LinkedIn profile</label><input type="url" id="f-linkedin" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="linkedin.com/in/yourname" maxlength="300" value="' + esc(c.linkedin || '') + '"><div class="fieldnote">Required. We look at it before your interview.</div></div>' +
        '</div><div class="err" id="err"></div><div class="actions"><button type="button" class="btn" id="next">Next</button></div>';
    } else if (st.type === 'q') {
      var q = st.q, cur = state.answers[q.key];
      h += '<h2>' + esc(q.title) + '</h2>' + (q.hint ? '<p class="hint">' + esc(q.hint) + '</p>' : '') + '<div class="opts" role="radiogroup">';
      q.opts.forEach(function (o, i) {
        h += '<button type="button" class="opt" role="radio" aria-checked="' + (cur === o) + '" data-i="' + i + '"><span class="mk"></span><span class="tx">' + esc(o) + '</span></button>';
      });
      h += '</div><div class="err" id="err"></div>';
    } else if (st.type === 'reference') {
      var rr = roleOf(state.role) || {}, ref = state.reference;
      h += '<h2>Who Can We Call About You?</h2><p class="hint">' + esc(rr.referencePrompt || '') + ' Let them know we might call.</p>' +
        '<div class="fields">' +
        '<div><label for="f-ref-name">Their name</label><input type="text" id="f-ref-name" autocomplete="off" maxlength="120" value="' + esc(ref.name || '') + '"></div>' +
        '<div><label for="f-ref-phone">Their phone number</label><input type="tel" id="f-ref-phone" autocomplete="off" inputmode="tel" placeholder="(555) 555-5555" maxlength="14" value="' + esc(ref.phone || '') + '"></div>' +
        '<div><label for="f-ref-company">Company you worked together at</label><input type="text" id="f-ref-company" autocomplete="off" maxlength="120" value="' + esc(ref.company || '') + '"></div>' +
        '</div><p class="hint" style="margin-top:16px">How do you know them?</p><div class="opts" role="radiogroup">';
      (rr.referenceRelationships || []).forEach(function (o, i) {
        h += '<button type="button" class="opt" role="radio" aria-checked="' + (ref.relationship === o) + '" data-i="' + i + '"><span class="mk"></span><span class="tx">' + esc(o) + '</span></button>';
      });
      h += '</div><div class="err" id="err"></div><div class="actions"><button type="button" class="btn" id="next">Next</button></div>';
    } else {
      var r = roleOf(state.role);
      h += '<h2>Record a 90-Second Loom</h2><p class="hint">Record it on loom.com, copy the share link, and paste it here. A free Loom account works.</p>' +
        '<div class="prompt"><b>Your prompt</b>' + esc(r ? r.loomPrompt : '') + '</div>' +
        '<div class="fields"><div><label for="f-loom">Loom share link</label><input type="url" id="f-loom" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="loom.com/share/…" maxlength="300" value="' + esc(state.loom) + '"></div></div>' +
        '<div class="err" id="err"></div><div class="actions"><button type="button" class="btn" id="submit">Submit Application</button></div>';
    }
    body.innerHTML = h + '</div>';
    wire(st);
  }

  function err(msg) { var e = document.getElementById('err'); if (e) e.textContent = msg || ''; }
  function go(n) { at = n; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function next() { go(Math.min(at + 1, steps().length - 1)); }

  function wire(st) {
    if (st.type === 'role') {
      body.querySelectorAll('.opt').forEach(function (b) {
        b.addEventListener('click', function () {
          body.querySelectorAll('.opt').forEach(function (x) { x.setAttribute('aria-checked', 'false'); });
          b.setAttribute('aria-checked', 'true');
          var picked = b.getAttribute('data-role');
          if (picked !== state.role) {
            /* Keep only the answers the new seat is asked; the server refuses
               any question that is not for the seat. */
            var keep = {};
            S.questions.forEach(function (q) {
              if (q.roles.indexOf(picked) > -1 && state.answers[q.key] != null) keep[q.key] = state.answers[q.key];
            });
            state.answers = keep;
            state.role = picked;
          }
          setTimeout(next, 220);
        });
      });
    } else if (st.type === 'q') {
      body.querySelectorAll('.opt').forEach(function (b) {
        b.addEventListener('click', function () {
          body.querySelectorAll('.opt').forEach(function (x) { x.setAttribute('aria-checked', 'false'); });
          b.setAttribute('aria-checked', 'true');
          state.answers[st.q.key] = st.q.opts[+b.getAttribute('data-i')];
          setTimeout(next, 220);
        });
      });
    } else if (st.type === 'contact') {
      wireContact();
      document.getElementById('next').addEventListener('click', function () { if (readContact()) next(); });
      /* No focus on the first screen a visitor lands on: a phone would open its
         keyboard over the page before they have read it. */
      if (at > 0 || !SINGLE) document.getElementById('f-first').focus();
    } else if (st.type === 'reference') {
      var rels = (roleOf(state.role) || {}).referenceRelationships || [];
      var rp = document.getElementById('f-ref-phone');
      rp.value = fmtPhone(rp.value);
      rp.addEventListener('input', function () { rp.value = fmtPhone(rp.value); });
      var rn = document.getElementById('f-ref-name');
      rn.addEventListener('blur', function () { rn.value = capName(rn.value.trim()); });
      body.querySelectorAll('.opt').forEach(function (b) {
        b.addEventListener('click', function () {
          body.querySelectorAll('.opt').forEach(function (x) { x.setAttribute('aria-checked', 'false'); });
          b.setAttribute('aria-checked', 'true');
          state.reference.relationship = rels[+b.getAttribute('data-i')];
        });
      });
      document.getElementById('next').addEventListener('click', function () { if (readReference()) next(); });
      rn.focus();
    } else {
      var lm = document.getElementById('f-loom');
      lm.addEventListener('input', function () { state.loom = lm.value.trim(); });
      document.getElementById('submit').addEventListener('click', submit);
      lm.focus();
    }
  }

  function capName(v) { return v.replace(/\s+/g, ' ').replace(/(^|[\s\-'])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function fmtPhone(v) {
    var d = v.replace(/\D/g, '').replace(/^1/, '').slice(0, 10);
    if (d.length < 4) return d.length ? '(' + d : '';
    if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }
  function wireContact() {
    ['f-first', 'f-last'].forEach(function (id) {
      var el = document.getElementById(id);
      el.addEventListener('blur', function () { el.value = capName(el.value.trim()); });
    });
    var ph = document.getElementById('f-phone');
    ph.value = fmtPhone(ph.value);
    ph.addEventListener('input', function () { ph.value = fmtPhone(ph.value); });
  }
  function isLinkedIn(v) { return /^(https?:\/\/)?([a-z0-9-]+\.)*linkedin\.com\/\S+/i.test(v); }
  function isLoom(v) { return /^(https?:\/\/)?([a-z0-9-]+\.)*loom\.com\/\S+/i.test(v); }
  function readContact() {
    var c = {
      first: capName(document.getElementById('f-first').value.trim()),
      last: capName(document.getElementById('f-last').value.trim()),
      email: document.getElementById('f-email').value.trim().toLowerCase(),
      phone: document.getElementById('f-phone').value.trim(),
      linkedin: document.getElementById('f-linkedin').value.trim()
    };
    state.contact = c;
    if (!c.first || !c.last) { err('Add your first and last name.'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) { err('Check your email address.'); return false; }
    if (c.phone.replace(/\D/g, '').length !== 10) { err('Add a 10-digit phone number.'); return false; }
    if (!isLinkedIn(c.linkedin)) { err('Add your LinkedIn profile link, like linkedin.com/in/yourname.'); return false; }
    return true;
  }
  function readReference() {
    var r = state.reference;
    r.name = capName(document.getElementById('f-ref-name').value.trim());
    r.phone = document.getElementById('f-ref-phone').value.trim();
    r.company = document.getElementById('f-ref-company').value.trim();
    if (!r.name) { err('Add their name.'); return false; }
    var d = r.phone.replace(/\D/g, '');
    if (d.length !== 10) { err('Add their 10-digit phone number.'); return false; }
    if (d === String(state.contact.phone || '').replace(/\D/g, '')) { err('Use their phone number, not yours.'); return false; }
    if (!r.company) { err('Add the company you worked together at.'); return false; }
    if (!r.relationship) { err('Pick how you know them.'); return false; }
    return true;
  }

  /* Server error → what the applicant reads, and which step to send them to. */
  var ERRORS = {
    name_email_required: ['Check your name and email.', 'contact'],
    phone_required: ['Add a 10-digit phone number.', 'contact'],
    linkedin_required: ['Add your LinkedIn profile link, like linkedin.com/in/yourname.', 'contact'],
    linkedin_url_invalid: ['That LinkedIn link did not work. Use your profile link, like linkedin.com/in/yourname.', 'contact'],
    reference_required: ['Fill in every part of your reference.', 'reference'],
    reference_phone_invalid: ['Add your reference’s 10-digit phone number.', 'reference'],
    reference_same_as_you: ['Use your reference’s phone number, not yours.', 'reference'],
    loom_required: ['Paste your Loom share link.', null],
    loom_url_invalid: ['That link is not a Loom share link. It looks like loom.com/share/…', null],
    survey_incomplete: ['One answer is missing. Go back through the questions and pick one for each.', 'q'],
    survey_answer_unknown: ['Something in your answers did not match. Go back through the questions.', 'q'],
    role_unavailable: ['That seat just closed. Pick another seat.', 'role'],
    rate_limited: ['Too many tries in a row. Wait 15 minutes, then submit again.', null]
  };

  function attribution() {
    var p = new URLSearchParams(location.search);
    if (p.get('utm_source')) return { how_heard: 'ads', how_heard_detail: (p.get('utm_campaign') || p.get('utm_source') || '').slice(0, 200) };
    return {};
  }

  var sending = false;
  function submit() {
    if (sending) return;
    var lm = document.getElementById('f-loom');
    state.loom = lm.value.trim();
    if (!isLoom(state.loom)) { err('Paste your Loom share link. It looks like loom.com/share/…'); return; }
    var answers = {};
    questions().forEach(function (q) { if (state.answers[q.key] != null) answers[q.key] = state.answers[q.key]; });
    var payload = {
      funnel: "join",
      role: state.role,
      name: state.contact.first + ' ' + state.contact.last,
      email: state.contact.email,
      phone: state.contact.phone,
      linkedin: state.contact.linkedin,
      loom: state.loom,
      answers: answers,
      reference: {
        name: state.reference.name,
        phone: state.reference.phone,
        company: state.reference.company,
        relationship: state.reference.relationship
      },
      website: document.getElementById('f-website').value
    };
    var a = attribution();
    if (a.how_heard) { payload.how_heard = a.how_heard; payload.how_heard_detail = a.how_heard_detail; }

    sending = true;
    var btn = document.getElementById('submit');
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'server' }; }); })
      .then(function (res) {
        sending = false;
        if (res && res.ok) return finish(res);
        var e = ERRORS[res && res.error];
        var target = e && e[1] ? stepIndex(e[1]) : -1;
        if (target >= 0 && target !== at) { go(target); }
        else { btn.disabled = false; btn.textContent = 'Submit Application'; }
        err(e ? e[0] : 'Something went wrong on our side. Try again in a minute.');
      })
      .catch(function () {
        sending = false; btn.disabled = false; btn.textContent = 'Submit Application';
        err('Could not reach us. Check your connection and try again.');
      });
  }

  function finish(res) {
    document.getElementById('sv').hidden = true;
    document.getElementById('trust').hidden = true;
    var done = document.getElementById('done');
    var first = esc(state.contact.first || '');
    var who = esc(meets());
    var h;
    if (res.next === 'book' && /^https:\/\//.test(res.bookingUrl || '')) {
      document.getElementById('kicker').textContent = 'Application · Step 2 of 2';
      document.getElementById('title').textContent = 'One Step Left';
      document.getElementById('lede').textContent = 'Pick a time for your interview below.';
      h = '<div class="done"><div class="ok">✓</div><h2>Application received, ' + first + '</h2><p>Pick a time below to meet with ' + who + '.</p></div>';
      var cal = document.getElementById('cal');
      document.getElementById('cal-sub').textContent = 'You’ll meet with ' + meets() + '.';
      document.getElementById('cal-frame').src = res.bookingUrl;
      document.getElementById('cal-newtab').href = res.bookingUrl;
      cal.hidden = false;
      done.innerHTML = h; done.hidden = false;
      setTimeout(function () { cal.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250);
      return;
    }
    document.getElementById('kicker').textContent = 'Application received';
    document.getElementById('title').textContent = 'Thanks for Applying';
    document.getElementById('lede').textContent = '';
    if (res.next === 'book' || res.next === 'book_pending') {
      h = '<div class="done"><div class="ok">✓</div><h2>You’re all set, ' + first + '</h2><p>We got your application. ' + capFirst(who) + ' will reach out to set up your interview.</p></div>';
    } else {
      h = '<div class="done"><div class="ok">✓</div><h2>We got your application, ' + first + '</h2><p>' + capFirst(who) + ' reviews every application and reaches out to the best fits.</p></div>';
    }
    done.innerHTML = h; done.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  document.getElementById('back').addEventListener('click', function () { if (at > 0) go(at - 1); });
  render();
})();
