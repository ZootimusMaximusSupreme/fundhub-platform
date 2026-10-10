// A fake ClickFunnels workspace for the funnel push tests (build unit X4F).
//
// It is the real provider (src/messaging/providers/clickfunnels-pages.mjs) with a
// fake fetch behind it, so every test proves the push at the HTTP level: every
// request is recorded, and a test can check that the pages and funnels that
// were there before got no PUT, no POST and no DELETE.
//
// It answers the way the live workspace answered on 2026-10-06 (read only):
//   * a page's `url` is ALWAYS the workspace subdomain + the page's own path,
//     even for a page that is a step of a funnel on apply.fundhub.ai;
//   * a funnel step's address is the funnel's domain + show_page_step.current_path;
//   * a standalone page (no funnel) is served on the subdomain only, never on
//     apply.fundhub.ai;
//   * a page's own path is unique in the workspace (a taken one gets "--x1"),
//     a step's path is unique on its domain (a taken one gets "--d1").
//
// Options make it misbehave on purpose: busy (429s before a page is made),
// standalone (makes pages outside the funnel even when asked for one),
// stepSuffix (puts the step at another path), refuseMove (422 on moving a page
// onto a step), funnelNoDomain (makes funnels without the domain),
// ignoreSortOrder (always adds the step last), noApplyDomain, noAddress (a made
// page's answer carries no url, no step and no funnel; the page list is right).

import * as cfPages from "../../messaging/providers/clickfunnels-pages.mjs";

export const FAKE_ENV = Object.freeze({
  CLICKFUNNELS_API_KEY: "cf_test_key", CLICKFUNNELS_SUBDOMAIN: "acme", CLICKFUNNELS_WORKSPACE_ID: "77", ADAPTERS_DRY_RUN: "0"
});
export const SUB_HOST = "acme.myclickfunnels.com";
export const APPLY_HOST = "apply.fundhub.ai";
export const APPLY_DOMAIN_ID = 5002;

/** The live workspace's shape: two funnels on apply.fundhub.ai and the roadmap pages. */
export function liveLikeSeed() {
  return {
    funnels: [
      { id: 968281, public_id: "JopwAe", name: "Fundhub Funnel", current_path: "/vsl", domain_id: APPLY_DOMAIN_ID,
        steps: [
          { id: 3073580, current_path: "/watch", page: { id: 25061160, name: "VSL", current_path: "/vsl-page", custom_html_page: false, html: "<html>watch</html>" } },
          { id: 3073813, current_path: "/funding-book-call", page: { id: 25062844, name: "Funding Book Call", current_path: "/funding-book-call-page", custom_html_page: false, html: "<html>book</html>" } }
        ] },
      { id: 984178, public_id: "YxAGqw", name: "Fundhub $297 Roadmap", current_path: "/fundhub-297-roadmap", domain_id: APPLY_DOMAIN_ID,
        steps: [
          { id: 3134613, current_path: "/roadmap", page: { id: 25516164, name: "Fundhub $297 Roadmap Sales", current_path: "/fundhub-297-roadmap-sales", custom_html_page: true, html: "<html>roadmap</html>" } },
          { id: 3134614, current_path: "/roadmap-book", page: { id: 25516165, name: "Fundhub $297 Roadmap Book", current_path: "/fundhub-297-roadmap-book--5df25", custom_html_page: true, html: "<html>roadmap book</html>" } }
        ] }
    ],
    standalone: [
      { id: 25068989, name: "Apply", description: null, current_path: "/apply-page", custom_html_page: false, html: "<html>apply</html>" }
    ]
  };
}

let idBase = 10_000;

/**
 * @param {{ funnels?: any[], standalone?: any[], domains?: any[], busy?: number, standaloneOnly?: boolean,
 *           stepSuffix?: string|null, refuseMove?: boolean, funnelNoDomain?: boolean,
 *           ignoreSortOrder?: boolean, noApplyDomain?: boolean, noAddress?: boolean }} [opts]
 */
export function fakeClickFunnels(opts = {}) {
  const seed = opts.funnels || opts.standalone ? { funnels: opts.funnels || [], standalone: opts.standalone || [] } : liveLikeSeed();
  const domains = opts.domains || [
    { id: 5001, public_id: "Dsub", name: SUB_HOST, status: "ownership_verified", connected: true },
    ...(opts.noApplyDomain ? [] : [{ id: APPLY_DOMAIN_ID, public_id: "Dapp", name: APPLY_HOST, status: "secured", connected: true }])
  ];
  idBase += 1000;
  let nextId = idBase;
  const newId = () => ++nextId;
  let busyLeft = opts.busy || 0;
  const calls = [];

  /** Internal pages: { id, public_id, name, description, current_path, custom_html_page, html, token, stepId } */
  const pages = [];
  /** Internal funnels: { id, public_id, name, current_path, domain_id, archived, live_mode, stepIds: [] } */
  const funnels = [];
  /** stepId → { id, public_id, funnelId, current_path, pageId } */
  const steps = new Map();

  for (const f of seed.funnels) {
    const funnel = { id: f.id, public_id: f.public_id || `F${f.id}`, name: f.name, current_path: f.current_path, domain_id: f.domain_id ?? null, archived: !!f.archived, live_mode: true, stepIds: [] };
    funnels.push(funnel);
    for (const s of f.steps || []) {
      const p = s.page;
      pages.push({ id: p.id, public_id: p.public_id || `P${p.id}`, name: p.name, description: p.description ?? null, current_path: p.current_path, custom_html_page: !!p.custom_html_page, html: p.html || "", token: `cfp_${p.id}`, stepId: s.id });
      steps.set(String(s.id), { id: s.id, public_id: s.public_id || `S${s.id}`, funnelId: f.id, current_path: s.current_path, pageId: p.id });
      funnel.stepIds.push(s.id);
    }
  }
  for (const p of seed.standalone) {
    pages.push({ id: p.id, public_id: p.public_id || `P${p.id}`, name: p.name, description: p.description ?? null, current_path: p.current_path, custom_html_page: p.custom_html_page !== false, html: p.html || "", token: `cfp_${p.id}`, stepId: null });
  }
  const before = {
    pageIds: new Set(pages.map((p) => String(p.id))),
    funnelIds: new Set(funnels.map((f) => String(f.id)))
  };

  const stepOfPage = (p) => (p.stepId != null ? steps.get(String(p.stepId)) || null : null);
  const funnelById = (id) => funnels.find((f) => String(f.id) === String(id) || String(f.public_id) === String(id)) || null;
  const stepById = (id) => steps.get(String(id)) || [...steps.values()].find((s) => String(s.public_id) === String(id)) || null;

  function shown(p) {
    const s = stepOfPage(p);
    const f = s ? funnelById(s.funnelId) : null;
    return {
      id: p.id, public_id: p.public_id, workspace_id: 77, name: p.name, description: p.description,
      type: s ? "funnel_page" : "landing_page", custom_html_page: p.custom_html_page,
      current_path: p.current_path, url: `https://${SUB_HOST}${p.current_path}`,
      show_page_step: s ? { id: s.id, public_id: s.public_id, name: p.name, current_path: s.current_path, sort_order: f ? f.stepIds.indexOf(s.id) : 0, products: [] } : null,
      funnel: f ? { id: f.id, public_id: f.public_id, name: f.name } : null,
      sdk: { token: p.token }
    };
  }
  const shownFunnel = (f) => ({ id: f.id, public_id: f.public_id, workspace_id: 77, name: f.name, archived: f.archived, current_path: f.current_path, live_mode: f.live_mode, domain_id: f.domain_id, tags: [] });

  const ownPathTaken = (path) => pages.some((p) => p.current_path === path);
  const stepPathTaken = (domainId, path) => [...steps.values()].some((s) => {
    const f = funnelById(s.funnelId);
    return f && String(f.domain_id) === String(domainId) && s.current_path === path;
  });
  const uniqueOwn = (path) => { let p = path; let n = 0; while (ownPathTaken(p)) p = `${path}--x${++n}`; return p; };
  const slug = (s) => `/${String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

  const reply = (status, payload, headers = {}) => ({
    ok: status >= 200 && status < 300, status,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    headers: new Map(Object.entries(headers))
  });

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, host: u.host, path: u.pathname, body });

    if (u.host === SUB_HOST && u.pathname.startsWith("/api/v2/")) {
      const p = u.pathname.slice("/api/v2".length);
      if (method === "GET" && p === "/workspaces/77/pages") return reply(200, pages.map(shown));
      if (method === "GET" && p === "/workspaces/77/funnels") return reply(200, funnels.map(shownFunnel));
      if (method === "GET" && p === "/workspaces/77/domains") return reply(200, domains);

      if (method === "POST" && p === "/workspaces/77/funnels") {
        const b = body.funnel;
        let path = b.current_path;
        let n = 0;
        while (funnels.some((f) => f.current_path === path)) path = `${b.current_path}--f${++n}`;
        const id = newId();
        const f = { id, public_id: `F${id}`, name: b.name, current_path: path, domain_id: opts.funnelNoDomain ? null : (b.domain_id ?? null), archived: false, live_mode: b.live_mode !== false, stepIds: [] };
        funnels.push(f);
        return reply(201, shownFunnel(f));
      }

      if (method === "POST" && p === "/workspaces/77/pages/custom_html") {
        const b = body.page;
        if (busyLeft > 0) { busyLeft -= 1; return reply(429, { error: "Too many requests" }); }
        const id = newId();
        const fid = b.funnel && b.funnel.funnel_id;
        if (fid != null && !opts.standaloneOnly) {
          const f = funnelById(fid);
          if (!f) return reply(400, { error: "Bad request: The funnel or show_page_step with the provided ID cannot be found." });
          if (b.sort_order != null && (b.sort_order < 0 || b.sort_order > f.stepIds.length)) return reply(422, { error: "sort_order is out of bounds" });
          let stepPath = `${b.current_path}${opts.stepSuffix || ""}`;
          let n = 0;
          const want = stepPath;
          while (stepPathTaken(f.domain_id, stepPath)) stepPath = `${want}--d${++n}`;
          const page = { id, public_id: `P${id}`, name: b.name, description: b.description ?? null, current_path: uniqueOwn(`${slug(b.name)}-page`), custom_html_page: true, html: b.custom_html, token: `cfp_${id}`, stepId: null };
          const sid = newId();
          steps.set(String(sid), { id: sid, public_id: `S${sid}`, funnelId: f.id, current_path: stepPath, pageId: id });
          page.stepId = sid;
          pages.push(page);
          if (b.sort_order == null || opts.ignoreSortOrder) f.stepIds.push(sid);
          else f.stepIds.splice(b.sort_order, 0, sid);
          if (opts.noAddress) return reply(201, { ...shown(page), url: null, show_page_step: null, funnel: null });
          return reply(201, shown(page));
        }
        if (ownPathTaken(b.current_path)) return reply(422, { error: "path taken" });
        const page = { id, public_id: `P${id}`, name: b.name, description: b.description ?? null, current_path: b.current_path, custom_html_page: true, html: b.custom_html, token: `cfp_${id}`, stepId: null };
        pages.push(page);
        return reply(201, shown(page));
      }

      const pm = /^\/pages\/(\d+)$/.exec(p);
      if (pm) {
        const page = pages.find((x) => String(x.id) === pm[1]);
        if (!page) return reply(404, { error: "Not found: Record missing" });
        if (method === "GET") return reply(200, shown(page));
        if (method === "PUT") {
          const b = body.page || {};
          if (typeof b.custom_html === "string") page.html = b.custom_html;
          if (b.funnel && b.funnel.show_page_step_id != null) {
            if (opts.refuseMove) return reply(422, { error: "Request unprocessable: this page cannot be moved onto that step." });
            const s = stepById(b.funnel.show_page_step_id);
            if (!s) return reply(400, { error: "Bad request: The funnel or show_page_step with the provided ID cannot be found." });
            const prev = pages.find((x) => String(x.id) === String(s.pageId));
            if (prev) prev.stepId = null; // kept, unlinked
            s.pageId = page.id;
            page.stepId = s.id;
          }
          return reply(200, shown(page));
        }
      }

      const fm = /^\/funnels\/(\d+)\/structure$/.exec(p);
      if (fm && method === "GET") {
        const f = funnelById(fm[1]);
        if (!f) return reply(404, { error: "Not found" });
        return reply(200, {
          funnel: { id: f.id, public_id: f.public_id, name: f.name },
          steps: f.stepIds.map((sid, i) => {
            const s = steps.get(String(sid));
            const page = pages.find((x) => String(x.id) === String(s.pageId));
            return { id: 9_000_000 + sid, public_id: `W${sid}`, step_type: "show_page_step", name: page ? page.name : "", sort_order: i,
              show_page_step_id: s.public_id, page: page ? { id: page.id, public_id: page.public_id, name: page.name, url: `https://${SUB_HOST}${page.current_path}`, external: false } : null };
          })
        });
      }
      return reply(404, { error: "no route" });
    }

    if (u.host === APPLY_HOST) {
      const s = [...steps.values()].find((x) => {
        const f = funnelById(x.funnelId);
        return f && String(f.domain_id) === String(APPLY_DOMAIN_ID) && x.current_path === u.pathname;
      });
      const page = s ? pages.find((x) => String(x.id) === String(s.pageId)) : null;
      return page ? reply(200, page.html || "") : reply(404, "not found");
    }
    if (u.host === SUB_HOST) {
      const page = pages.find((x) => x.current_path === u.pathname);
      return page ? reply(200, page.html || "") : reply(404, "not found");
    }
    return reply(404, "unknown host");
  };

  const wrap = (fn) => (o) => fn({ ...o, fetchImpl });
  const cf = {
    cfCreds: cfPages.cfCreds,
    stepOf: cfPages.stepOf,
    listPages: wrap(cfPages.listPages),
    listFunnels: wrap(cfPages.listFunnels),
    listDomains: wrap(cfPages.listDomains),
    getPage: wrap(cfPages.getPage),
    funnelStructure: wrap(cfPages.funnelStructure),
    createFunnel: wrap(cfPages.createFunnel),
    createCustomHtmlPage: wrap(cfPages.createCustomHtmlPage),
    putOwnPageHtml: wrap(cfPages.putOwnPageHtml),
    moveOwnPageOntoStep: wrap(cfPages.moveOwnPageOntoStep),
    fetchLivePage: wrap(cfPages.fetchLivePage)
  };

  /** Writes (anything but GET) to the ClickFunnels API. */
  const writes = () => calls.filter((c) => c.method !== "GET" && c.path.startsWith("/api/v2/"));
  /** True when no request named a page or funnel that was there before. */
  const touchedBefore = () => calls.filter((c) => {
    const m = /^\/api\/v2\/(pages|funnels)\/(\d+)/.exec(c.path);
    if (!m) return false;
    return m[1] === "pages" ? before.pageIds.has(m[2]) : before.funnelIds.has(m[2]);
  });
  /** The address people open for a page, or null (a standalone page has none on apply.fundhub.ai). */
  const liveAddress = (pageId) => {
    const page = pages.find((x) => String(x.id) === String(pageId));
    const s = page ? stepOfPage(page) : null;
    const f = s ? funnelById(s.funnelId) : null;
    return f && String(f.domain_id) === String(APPLY_DOMAIN_ID) ? `https://${APPLY_HOST}${s.current_path}` : null;
  };
  /** A funnel's page ids in step order. */
  const stepPages = (funnelId) => {
    const f = funnelById(funnelId);
    return f ? f.stepIds.map((sid) => String(steps.get(String(sid)).pageId)) : [];
  };
  /** Seed a standalone page later (a page the first push made on its own). */
  const addStandalone = (p) => {
    const id = p.id ?? newId();
    const page = { id, public_id: p.public_id || `P${id}`, name: p.name || "page", description: p.description ?? null, current_path: p.current_path, custom_html_page: true, html: p.html || "", token: `cfp_${id}`, stepId: null };
    pages.push(page);
    return page;
  };

  return { cf, fetchImpl, calls, pages, funnels, steps, domains, before, writes, touchedBefore, liveAddress, stepPages, addStandalone, shown };
}
