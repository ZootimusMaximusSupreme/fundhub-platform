/* Pure, browser-compatible view rules for the Setter Dashboard. The browser
 * copy between FH-SETTER-VIEW markers is checked byte-for-byte by the test. */

function setterEsc(value) {
  return String(value == null ? "" : value).replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function setterDate(value) {
  if (!value || isNaN(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short"
  }).format(new Date(value));
}

function setterDialTarget(item) {
  var stamp = item && (item.booked_at || item.created_at);
  if (!stamp || isNaN(Date.parse(stamp))) return null;
  var first = new Date(stamp);
  var phoenix = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix", hour: "numeric", hourCycle: "h23"
  }).format(first);
  var hour = Number(phoenix);
  if (hour >= 6 && hour < 22) return new Date(first.getTime() + 60000).toISOString();
  var parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(first);
  var values = {};
  parts.forEach(function (part) { values[part.type] = part.value; });
  var next = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 13));
  if (hour >= 22) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function setterMissing(item, handoff) {
  var h = handoff || {};
  var missing = [];
  if (!item || !item.booked_at || !item.booking_time) missing.push("booked call time");
  if (!h.dialed_at) missing.push("dial logged");
  if (h.disposition !== "reached" && h.disposition !== "booked_on_call") missing.push("reached call result");
  if (h.disposition === "no_answer" && Number(h.call_attempts || 0) < 2) missing.push("second dial");
  if (!h.time_confirmed) missing.push("call time confirmed");
  if (!h.frame_warmed) missing.push("survey frame and warm-up");
  if (!String(h.problem || "").trim()) missing.push("problem");
  if (!String(h.goal || "").trim()) missing.push("goal");
  if (h.computer_ready !== true && h.computer_ready !== false) missing.push("computer answer");
  if (h.app_on_phone !== true && h.app_on_phone !== false) missing.push("app answer");
  if (item && (item.lead_type === "opt_in" || h.lead_type === "opt_in")) {
    if (!String(h.triage_problem || "").trim()) missing.push("triage problem");
    if (!String(h.triage_goal || "").trim()) missing.push("triage goal");
    if (h.triage_personal_or_business !== "personal" && h.triage_personal_or_business !== "business") missing.push("personal or business");
  }
  return missing;
}

function setterSorted(items) {
  return (Array.isArray(items) ? items : []).slice().sort(function (a, b) {
    if (a.needs_work === false && b.needs_work !== false) return 1;
    if (b.needs_work === false && a.needs_work !== false) return -1;
    return Date.parse(b.booked_at || b.created_at || 0) - Date.parse(a.booked_at || a.created_at || 0);
  });
}

export { setterEsc, setterDate, setterDialTarget, setterMissing, setterSorted };
