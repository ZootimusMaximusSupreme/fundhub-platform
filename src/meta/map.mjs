// Only events originating from these reviewed public pages may reach Meta.
// All handling of qualification, applications, payments and reports stays internal.
export const PUBLIC_META_PAGES = Object.freeze(["/watch", "/blueprint"]);
export const CONVERSION_SOURCE = "https://apply.fundhub.ai/apply";
const BOOKING_PAGES = new Set(["/apply", "/blueprint-book", "/funding-book-call", "/funding-book-call--02424"]);
const SURVEY_PAGES = new Map([["/apply", "apply"], ["/home", "home"]]);
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Track rows can retain legacy ids for first-party attribution without exporting them.
export function cleanMetaEventId(raw) {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(id) ? id : null;
}
export function isMetaUuid(id) {
  return typeof id === "string" && UUID4.test(id);
}

export const META_MAP = Object.freeze([
  { event: "page_view", meta: "PageView", match: row => PUBLIC_META_PAGES.includes(row.page) },
  { event: "page_view", meta: "ViewContent", match: row => PUBLIC_META_PAGES.includes(row.page), suffix: ".vc" },
  { event: "survey_answer", meta: "Lead", match: row => SURVEY_PAGES.has(row.page)
      && row.props?.survey === SURVEY_PAGES.get(row.page) && row.props.last === true && row.props.completion_acknowledged === true },
  { event: "booking_confirmed", meta: "Schedule", match: row => BOOKING_PAGES.has(row.page)
      && row.props?.calendar === "funding-book-call" }
]);

export const META_EVENT_NAMES = Object.freeze(META_MAP.map(rule => rule.meta));

export function metaEventsFor(row) {
  if (!row || !isMetaUuid(row.meta_event_id)) return [];
  if ((row.page === "/blueprint" || row.page === "/blueprint-book") && row.funnel_tag !== "fnl-blueprint") return [];
  return META_MAP.filter(rule => rule.event === row.event && rule.match(row)).map(rule => {
    const conversion = rule.meta === "Lead" || rule.meta === "Schedule";
    return {
      event_name: rule.meta,
      event_id: row.meta_event_id + (rule.suffix || ""),
      event_source_url: conversion ? CONVERSION_SOURCE : "https://apply.fundhub.ai" + row.page
    };
  });
}
