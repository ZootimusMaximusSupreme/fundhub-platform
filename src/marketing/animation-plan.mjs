// src/marketing/animation-plan.mjs — checks the animations the writer plans for a script.
//
// The writer (spec §7.6) hands back animation_plan: [{anchor, template, props, seconds}].
// This file says whether that plan can be built, and why not when it cannot.
// It is pure: no database, no files, no network. The catalog comes in as an
// argument (marketing/broll/catalog.json, built by src/marketing/catalog.mjs).
//
// THE RULES, AND WHERE EACH ONE COMES FROM
// 1. The template is in the catalog (spec §7.6: "Templates come from the
//    catalog only").
// 2. seconds sits inside the template's own length range: min_frames / fps to
//    max_frames / fps (spec §7.3, §9.4).
// 3. Every props key is one of the template's default_props keys (spec §7.3:
//    "props from defaultProps"). A key the template never declared would be
//    dropped silently by Remotion, so the writer would think it set something
//    it did not.
// 4. A data-tied template takes no props at all (spec §7.3; laws
//    sample-clients-consistent and proof-cards-from-source). Those templates
//    read only their own sample or approval files, so a dollar figure, a name
//    or an approval the writer sends would put an invented number on screen.
// 5. The anchor points at real words (spec §7.6):
//    - words style: {phrase} — the exact phrase, as written in the body,
//      capital letters included, on word edges. Runs of spaces and line breaks
//      count as one space.
//    - bullets style: {cue, keyword} — cue is the cue's number, counting the
//      parts whose kind is "cue" from 1 (the API contract's own examples count
//      from 1), and keyword is a word or words in that cue (any case).
// 6. How many: a standard ad needs at least 2, a sorting-hat short at least 1,
//    and every other format at least 1 (Appendix B; spec §7.6 "Every ad gets
//    at least one animation").
//
// Errors are {item, code, message}: item is the plan index (null for the plan
// as a whole), code is a short word a program can branch on, and message is a
// plain sentence the writer's fix round and the Command Center can both show.

/* The data-tied templates. Spec §7.3 names QualifyToday, LettersWritten,
   ProofWall, the ApprovalCarousel family and the ProofFlood family. Only
   QualifyToday, ProofWall and ProofFlood (with ProofFloodWide) exist in the kit
   today; LettersWritten and any ApprovalCarousel are matched by name prefix so
   they are tied the day they are added. */
export const DATA_TIED = Object.freeze(new Set(["QualifyToday", "ProofWall", "ProofFlood", "ProofFloodWide"]));
export const DATA_TIED_PREFIXES = Object.freeze(["ApprovalCarousel", "LettersWritten", "ProofFlood"]);

export function isDataTied(templateId) {
  if (typeof templateId !== "string") return false;
  return DATA_TIED.has(templateId) || DATA_TIED_PREFIXES.some((p) => templateId.startsWith(p));
}

/* The fewest animations each script format needs (Appendix B). Any format not
   listed needs DEFAULT_MIN_ANIMATIONS. */
export const MIN_ANIMATIONS = Object.freeze({ standard: 2, sorting: 1 });
export const DEFAULT_MIN_ANIMATIONS = 1;

/* The script formats and styles spec §7.1 and the API contract name. */
export const SCRIPT_FORMATS = Object.freeze(["standard", "sorting", "long", "notes", "greenscreen", "vsl"]);
export const STYLES = Object.freeze(["words", "bullets"]);

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Collapse every run of whitespace to one space and trim. */
function squash(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** True when `needle` appears in `hay` with no letter or digit glued to either end. */
function containsOnWordEdges(hay, needle) {
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : hay[at - 1];
    const after = hay[at + needle.length] ?? "";
    const startsWord = WORD_CHAR.test(needle[0]);
    const endsWord = WORD_CHAR.test(needle[needle.length - 1]);
    const leftOk = !startsWord || !before || !WORD_CHAR.test(before);
    const rightOk = !endsWord || !after || !WORD_CHAR.test(after);
    if (leftOk && rightOk) return true;
    from = at + 1;
  }
}

function minimumFor(scriptFormat) {
  return Object.prototype.hasOwnProperty.call(MIN_ANIMATIONS, scriptFormat)
    ? MIN_ANIMATIONS[scriptFormat]
    : DEFAULT_MIN_ANIMATIONS;
}

const fmtSeconds = (n) => String(Math.round(n * 100) / 100);

/**
 * validateAnimationPlan(plan, {catalog, body, parts, style, scriptFormat}) -> {ok, errors}
 *
 * plan:          the writer's animation_plan array
 * catalog:       marketing/broll/catalog.json (an array of entries)
 * body:          the script's teleprompter text (words style anchors live here)
 * parts:         [{kind, text}] (bullets style anchors live in the "cue" parts)
 * style:         "words" | "bullets"
 * scriptFormat:  "standard" | "sorting" | "long" | "notes" | "greenscreen" | "vsl"
 */
export function validateAnimationPlan(plan, { catalog, body, parts, style, scriptFormat } = {}) {
  const errors = [];
  const add = (item, code, message) => errors.push({ item, code, message });

  if (!Array.isArray(catalog) || catalog.length === 0) {
    add(null, "no_catalog", "The animation catalog is missing, so no animation can be checked.");
    return { ok: false, errors };
  }
  const byId = new Map(catalog.filter((e) => e && typeof e.id === "string").map((e) => [e.id, e]));

  if (!STYLES.includes(style)) {
    add(null, "unknown_style", `The script style must be words or bullets, not ${JSON.stringify(style ?? null)}.`);
  }
  if (!SCRIPT_FORMATS.includes(scriptFormat)) {
    add(null, "unknown_format", `The script format ${JSON.stringify(scriptFormat ?? null)} is not one of ${SCRIPT_FORMATS.join(", ")}.`);
  }
  if (!Array.isArray(plan)) {
    add(null, "not_a_list", "The animation plan must be a list.");
    return { ok: false, errors };
  }

  const need = minimumFor(scriptFormat);
  if (plan.length < need) {
    const what = SCRIPT_FORMATS.includes(scriptFormat) ? `A ${scriptFormat} script` : "Every ad";
    add(null, "too_few", `${what} needs at least ${need} animation${need === 1 ? "" : "s"}. This plan has ${plan.length}.`);
  }

  const bodyText = squash(typeof body === "string" ? body : "");
  const cues = Array.isArray(parts) ? parts.filter((p) => p && p.kind === "cue") : [];

  plan.forEach((item, i) => {
    const n = i + 1;
    if (!isPlainObject(item)) {
      add(i, "not_an_object", `Animation ${n} must be an object with anchor, template, props and seconds.`);
      return;
    }

    // 1. The template.
    const entry = typeof item.template === "string" ? byId.get(item.template) : undefined;
    if (!entry) {
      add(i, "unknown_template", `Animation ${n} names ${JSON.stringify(item.template ?? null)}, which is not in the animation catalog.`);
    }

    // 2. The length.
    if (entry) {
      const s = item.seconds;
      const minS = entry.min_frames / entry.fps;
      const maxS = entry.max_frames / entry.fps;
      if (typeof s !== "number" || !Number.isFinite(s)) {
        add(i, "bad_seconds", `Animation ${n} needs seconds as a number between ${fmtSeconds(minS)} and ${fmtSeconds(maxS)}.`);
      } else {
        const frames = s * entry.fps;
        if (frames < entry.min_frames - 1e-9 || frames > entry.max_frames + 1e-9) {
          add(i, "seconds_out_of_range", `Animation ${n} runs ${fmtSeconds(s)} seconds. ${entry.id} runs ${fmtSeconds(minS)} to ${fmtSeconds(maxS)} seconds.`);
        }
      }
    }

    // 3 and 4. The props.
    const props = item.props === undefined || item.props === null ? {} : item.props;
    if (!isPlainObject(props)) {
      add(i, "bad_props", `Animation ${n} needs props as an object.`);
    } else if (entry || typeof item.template === "string") {
      const keys = Object.keys(props);
      const tied = (entry && entry.data_tied === true) || isDataTied(item.template);
      if (tied && keys.length) {
        add(i, "data_tied_props", `Animation ${n} uses ${item.template}, which shows only its own real files. Send it no props. It got: ${keys.join(", ")}.`);
      } else if (entry && !tied) {
        const allowed = isPlainObject(entry.default_props) ? Object.keys(entry.default_props) : [];
        const unknown = keys.filter((k) => !allowed.includes(k));
        if (unknown.length) {
          add(i, "unknown_props", `Animation ${n} sends ${unknown.join(", ")}, which ${entry.id} does not take. It takes: ${allowed.join(", ") || "nothing"}.`);
        }
      }
    }

    // 5. The anchor.
    const a = item.anchor;
    if (style === "words") {
      if (!isPlainObject(a) || typeof a.phrase !== "string" || !a.phrase.trim()) {
        add(i, "bad_anchor", `Animation ${n} needs an anchor like {"phrase": "words copied from the script"}.`);
      } else if (!containsOnWordEdges(bodyText, squash(a.phrase))) {
        add(i, "anchor_not_in_body", `Animation ${n} is anchored to "${squash(a.phrase)}", which is not in the script word for word. Copy the phrase exactly, capital letters included.`);
      }
    } else if (style === "bullets") {
      if (!isPlainObject(a) || !Number.isInteger(a.cue) || typeof a.keyword !== "string" || !a.keyword.trim()) {
        add(i, "bad_anchor", `Animation ${n} needs an anchor like {"cue": 1, "keyword": "a word in that cue"}.`);
      } else if (a.cue < 1 || a.cue > cues.length) {
        add(i, "no_such_cue", `Animation ${n} points at cue ${a.cue}, but the script has ${cues.length} cue${cues.length === 1 ? "" : "s"}.`);
      } else {
        const cueText = squash(cues[a.cue - 1].text ?? "").toLowerCase();
        if (!containsOnWordEdges(cueText, squash(a.keyword).toLowerCase())) {
          add(i, "keyword_not_in_cue", `Animation ${n} looks for "${squash(a.keyword)}" in cue ${a.cue}, but that cue says "${squash(cues[a.cue - 1].text ?? "")}".`);
        }
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

export default validateAnimationPlan;
