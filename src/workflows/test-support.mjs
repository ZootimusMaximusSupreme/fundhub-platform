// Shared Postgres fake + Inngest step fake for src/workflows/*.test.mjs.
// Not a test file itself (no ".test." in the name) — node --test won't pick it up.
//
// Mirrors the in-memory fakes already inlined per-file in src/handlers/*.test.mjs,
// pulled into one place because every workflow port in this directory needs the
// same handful of tables (clients, events, message_templates, messages, tasks).
// Extend the `query` branches here as later batches touch new tables rather than
// re-inventing a fake per workflow file.

export function pgFake(seed = {}) {
  const clients = seed.clients || [];
  const events = seed.events || [];
  const templates = seed.templates || [];
  const bookings = seed.bookings || [];
  const fundingRounds = seed.fundingRounds || [];
  const applications = seed.applications || [];
  const inquiryLog = seed.inquiryLog || [];
  // pipelines/stages: [{ pipeline_key, stage_key, pipeline_id, stage_id }]
  const pipelineStages = seed.pipelineStages || [];
  const cards = seed.cards || [];
  const behaviorScores = seed.behaviorScores || [];
  const invoices = seed.invoices || [];
  const invoicePayments = seed.invoicePayments || [];
  const paymentLinks = seed.paymentLinks || [];
  const crsResults = seed.crsResults || [];
  const messages = [];
  const tasks = [];
  let n = 0;
  let payN = 0;

  const findClientByEmail = (org, email) =>
    clients.find((c) => c.org_id === org && String(c.email || "").toLowerCase() === String(email).toLowerCase());

  return {
    clients, events, templates, bookings, messages, tasks, fundingRounds, applications, inquiryLog, pipelineStages, cards, behaviorScores, invoices, invoicePayments, paymentLinks, crsResults,
    async query(sql, params = []) {
      if (/SELECT starts_at FROM bookings/.test(sql)) {
        const row = bookings
          .filter((b) => b.org_id === params[0] && b.client_id === params[1] &&
            ["booked", "rescheduled"].includes(b.status) && new Date(b.starts_at) > new Date())
          .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
        return { rows: row ? [{ starts_at: new Date(row.starts_at) }] : [] };
      }
      // --- behavior_scores (BC-01/BC-02) ---
      if (/INSERT INTO behavior_scores \(org_id, client_id, responsiveness\)/.test(sql)) {
        behaviorScores.push({ org_id: params[0], client_id: params[1], responsiveness: params[2] });
        return { rows: [] };
      }
      if (/INSERT INTO behavior_scores \(org_id, client_id, friction\)/.test(sql)) {
        behaviorScores.push({ org_id: params[0], client_id: params[1], friction: params[2] });
        return { rows: [] };
      }
      // --- pipeline_stages/pipelines lookup + cards find-or-create (move/advance) ---
      if (/SELECT ps\.id AS stage_id, ps\.pipeline_id/.test(sql) && /FROM pipeline_stages/.test(sql)) {
        const [pipelineKey, stageKey, orgId] = params;
        const row = pipelineStages.find((r) =>
          r.pipeline_key === pipelineKey && r.stage_key === stageKey &&
          (orgId == null || r.org_id == null || r.org_id === orgId));
        return {
          rows: row
            ? [{
              stage_id: row.stage_id,
              pipeline_id: row.pipeline_id,
              sort_order: row.sort_order ?? 0
            }]
            : []
        };
      }
      // advanceCardToStage — current card stage + sort_order
      if (/SELECT ps\.key AS stage_key, ps\.sort_order/.test(sql) && /FROM cards c/.test(sql)) {
        const [clientId, pipelineKey, orgId] = params;
        const card = cards.find((c) => {
          if (c.client_id !== clientId) return false;
          const stage = pipelineStages.find((r) =>
            r.pipeline_id === c.pipeline_id && r.stage_id === c.stage_id &&
            r.pipeline_key === pipelineKey &&
            (orgId == null || r.org_id == null || r.org_id === orgId));
          return Boolean(stage);
        });
        if (!card) return { rows: [] };
        const stage = pipelineStages.find((r) =>
          r.pipeline_id === card.pipeline_id && r.stage_id === card.stage_id);
        return {
          rows: stage
            ? [{ stage_key: stage.stage_key, sort_order: stage.sort_order ?? 0 }]
            : []
        };
      }
      if (/SELECT id FROM cards WHERE client_id/.test(sql)) {
        const [clientId, pipelineId] = params;
        const c = cards.find((c) => c.client_id === clientId && c.pipeline_id === pipelineId);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/UPDATE cards SET stage_id/.test(sql)) {
        const c = cards.find((c) => c.id === params[0]);
        if (c) c.stage_id = params[1];
        return { rows: [] };
      }
      if (/INSERT INTO cards/.test(sql)) {
        const id = "card-" + ++n;
        cards.push({ id, org_id: params[0], client_id: params[1], pipeline_id: params[2], stage_id: params[3] });
        return { rows: [] };
      }
      // The explicit client ID is untrusted until it belongs to this tenant.
      // Match resolveClient's real SELECT exactly; returning a synthetic
      // customer unconditionally here would conceal a cross-tenant regression.
      if (/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2 LIMIT 1/.test(sql)) {
        const c = clients.find((row) => row.id === params[0] && row.org_id === params[1]);
        return { rows: c ? [{ exists: 1 }] : [] };
      }
      // --- clients (resolveClient, shared with src/handlers/client-lifecycle.mjs) ---
      if (/SELECT id FROM clients WHERE org_id=\$1 AND phone=\$2/.test(sql)) {
        const c = clients.find((c) => c.org_id === params[0] && c.phone === params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      // Funding handoff must resolve an EXISTING customer in the triggering
      // organization; matching an arbitrary id/email from another org is unsafe.
      if (/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) {
        const c = clients.find((c) => c.id === params[0] && c.org_id === params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/SELECT id FROM clients/.test(sql)) {
        const c = findClientByEmail(params[0], params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/INSERT INTO clients/.test(sql)) {
        if (findClientByEmail(params[0], params[1])) return { rows: [] };
        const id = "cl-" + ++n;
        clients.push({ id, org_id: params[0], email: params[1], first_name: params[2], last_name: params[3] });
        return { rows: [{ id }] };
      }

      // --- clients.funded lookup (N-06 still-eligible re-check) ---
      if (/SELECT funded FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ funded: Boolean(c.funded) }] : [] };
      }

      // --- clients.tags lookup (friction classification) ---
      if (/SELECT tags FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ tags: c.tags || [] }] : [] };
      }

      // --- clients identity lookup (DS-01 email+phone gate) ---
      if (/SELECT email, phone FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ email: c.email || null, phone: c.phone || null }] : [] };
      }

      // --- clients.custom_fields + tags together (DPC-05 escalation gating) ---
      if (/SELECT custom_fields, tags FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ custom_fields: c.custom_fields || {}, tags: c.tags || [] }] : [] };
      }

      // --- clients.custom_fields lookup (pod-assigned / docs-status checks) ---
      if (/SELECT custom_fields FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ custom_fields: c.custom_fields || {} }] : [] };
      }

      // --- clients identity for sendTemplated merge tags ---
      if (/SELECT first_name, last_name, email, phone, custom_fields FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{
          first_name: c.first_name || null,
          last_name: c.last_name || null,
          email: c.email || null,
          phone: c.phone || null,
          custom_fields: c.custom_fields || {}
        }] : [] };
      }

      // --- invoices (AR chase re-check) ---
      if (/INSERT INTO invoices/.test(sql)) {
        const sourceEventId = params[4];
        const idem = params[12];
        if (idem && invoices.find((i) => i.idempotency_key === idem)) return { rows: [] };
        if (sourceEventId && invoices.find((i) => i.source_event_id === sourceEventId)) return { rows: [] };
        const row = {
          id: "inv-" + ++n,
          org_id: params[0],
          client_id: params[1],
          invoice_type: params[2],
          source: params[3],
          source_event_id: params[4],
          amount_due: params[5],
          currency: params[6],
          sale_id: params[7],
          funding_round_id: params[8],
          due_at: params[9],
          provider: params[10],
          external_ref: params[11],
          idempotency_key: params[12],
          notes: params[13],
          status: "draft"
        };
        invoices.push(row);
        return { rows: [row] };
      }
      if (/UPDATE invoices[\s\S]*status = 'sent'/.test(sql)) {
        const row = invoices.find((i) => i.id === params[0] && i.status === "draft");
        if (!row) return { rows: [] };
        row.status = "sent";
        row.sent_at = params[1];
        return { rows: [row] };
      }
      if (/SELECT \* FROM invoices WHERE id/.test(sql)) {
        const row = invoices.find((i) => i.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/FROM invoices[\s\S]*external_ref = ANY/.test(sql)) {
        const refs = params[0] || [];
        const hit = invoices
          .filter((i) => i.external_ref && refs.includes(i.external_ref))
          .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
        return { rows: hit[0] ? [hit[0]] : [] };
      }
      if (/FROM invoices[\s\S]*funding_round_id/.test(sql) && /success_fee/.test(sql)) {
        const [clientId, roundId, open] = params;
        const hit = invoices
          .filter((i) =>
            i.client_id === clientId
            && i.funding_round_id === roundId
            && (i.source === "funding_success_fee" || i.invoice_type === "success_fee")
            && (!Array.isArray(open) || open.includes(i.status)))
          .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))
            || String(a.id).localeCompare(String(b.id)));
        return { rows: hit[0] ? [hit[0]] : [] };
      }
      if (/FROM invoices[\s\S]*client_id/.test(sql) && /success_fee/.test(sql)) {
        const open = Array.isArray(params[1]) ? params[1] : [];
        return {
          rows: invoices.filter((i) =>
            i.client_id === params[0]
            && (i.source === "funding_success_fee" || i.invoice_type === "success_fee")
            && (open.length ? open.includes(i.status) : true))
        };
      }
      if (/UPDATE invoices[\s\S]*status = 'partially_paid'/.test(sql)) {
        const row = invoices.find((i) => i.id === params[0]);
        const allowed = Array.isArray(params[1]) ? params[1] : [];
        if (!row || (allowed.length && !allowed.includes(row.status))) return { rows: [] };
        row.status = "partially_paid";
        return { rows: [row] };
      }
      if (/UPDATE invoices SET external_ref = COALESCE/.test(sql)) {
        const row = invoices.find((i) => i.id === params[0]);
        if (row && !row.external_ref) row.external_ref = params[1];
        return { rows: row ? [row] : [] };
      }
      if (/FROM invoice_payments WHERE invoice_id/.test(sql) && /SUM/.test(sql)) {
        const paid = invoicePayments
          .filter((p) => p.invoice_id === params[0])
          .reduce((sum, p) => sum + (p.kind === "payment" ? Number(p.amount) : -Number(p.amount)), 0);
        return { rows: [{ paid }] };
      }
      if (/FROM invoice_payments[\s\S]*external_ref/.test(sql)) {
        const hit = invoicePayments.find((p) => p.org_id === params[0] && p.external_ref === params[1]);
        return { rows: hit ? [hit] : [] };
      }
      if (/INSERT INTO invoice_payments/.test(sql)) {
        const [org_id, invoice_id, amount, external_ref, source_event_id] = params;
        if (external_ref && invoicePayments.some((p) => p.org_id === org_id && p.external_ref === external_ref)) {
          return { rows: [] };
        }
        const row = {
          id: "ip-" + ++payN,
          org_id, invoice_id, kind: "payment", amount,
          method: "commas", external_ref, source_event_id
        };
        invoicePayments.push(row);
        return { rows: [row] };
      }
      if (/FROM payment_links pl/.test(sql) && /LEFT JOIN products/.test(sql)) {
        const [orgId, clientId] = params;
        return {
          rows: paymentLinks
            .filter((p) => p.org_id === orgId && p.client_id === clientId && (p.status === "paid" || p.paid_at))
            .map((p) => ({
              status: p.status,
              paid_at: p.paid_at || null,
              description: p.description || null,
              product_code: p.product_code || null
            }))
        };
      }
      if (/FROM payment_links pl/.test(sql) && /JOIN invoices old/.test(sql)) {
        const [orgId, clientId, roundId, saleId, invoiceId] = params;
        return { rows: paymentLinks.filter((p) => {
          const old = invoices.find((i) => i.id === p.invoice_id);
          return old && old.org_id === orgId && old.client_id === clientId &&
            old.funding_round_id === roundId && (old.sale_id || null) === saleId &&
            old.id !== invoiceId && old.status === "void" &&
            (p.provider || "commas") === "commas" &&
            ["created", "sent", "expired"].includes(p.status);
        }).map((p) => ({ id: p.id, invoice_id: p.invoice_id })) };
      }
      if (/FROM payment_links\s+WHERE invoice_id = \$1/.test(sql) && /status = 'expired'/.test(sql)) {
        const [invoiceId, orgId, dueCents] = params;
        return { rows: paymentLinks.filter((p) => p.invoice_id === invoiceId && p.org_id === orgId &&
          (p.provider || "commas") === "commas" &&
          (p.status === "expired" || (["created", "sent"].includes(p.status) && p.amount_cents !== dueCents)))
          .map((p) => ({ id: p.id })) };
      }
      if (/FROM payment_links\s+WHERE invoice_id = \$1/.test(sql)) {
        const [invoiceId, orgId] = params;
        const hit = paymentLinks
          .filter((p) => p.invoice_id === invoiceId && p.org_id === orgId &&
            (p.provider || "commas") === "commas" &&
            ["created", "sent"].includes(p.status) && p.checkout_url)
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
        return { rows: hit ? [{ id: hit.id, amount_cents: hit.amount_cents, checkout_url: hit.checkout_url }] : [] };
      }
      if (/UPDATE payment_links[\s\S]*SET status = 'expired'/.test(sql)) {
        const [linkId, orgId, invoiceId] = params;
        const link = paymentLinks.find((p) => p.id === linkId && p.org_id === orgId && p.invoice_id === invoiceId);
        if (!link || !["created", "sent"].includes(link.status)) return { rows: [] };
        link.status = "expired";
        return { rows: [link] };
      }
      if (/UPDATE payment_links[\s\S]*SET status = 'void'/.test(sql)) {
        const [linkId, orgId, invoiceId] = params;
        const link = paymentLinks.find((p) => p.id === linkId && p.org_id === orgId && p.invoice_id === invoiceId);
        if (!link || link.status !== "expired") return { rows: [] };
        link.status = "void";
        return { rows: [{ id: link.id }] };
      }
      if (/FROM payment_links[\s\S]*link_ref/.test(sql)) {
        const hit = paymentLinks.find((p) => p.link_ref === params[0] && p.invoice_id);
        return { rows: hit ? [{ invoice_id: hit.invoice_id }] : [] };
      }
      if (/FROM payment_links[\s\S]*id = \$1/.test(sql)) {
        const hit = paymentLinks.find((p) => p.id === params[0] && p.invoice_id);
        return { rows: hit ? [{ invoice_id: hit.invoice_id }] : [] };
      }
      if (/UPDATE invoices[\s\S]*status = 'escalated'/.test(sql)) {
        const row = invoices.find((i) => i.id === params[0]);
        const allowed = Array.isArray(params[2]) ? params[2] : ["sent", "reminded"];
        if (!row || !allowed.includes(row.status)) return { rows: [] };
        row.status = "escalated";
        row.escalated_at = params[1];
        return { rows: [row] };
      }
      if (/UPDATE invoices[\s\S]*status = 'paid'/.test(sql)) {
        const row = invoices.find((i) => i.id === params[0]);
        const allowed = Array.isArray(params[2]) ? params[2] : ["draft", "sent", "reminded", "escalated", "partially_paid"];
        if (!row || !allowed.includes(row.status)) return { rows: [] };
        row.status = "paid";
        row.paid_at = params[1];
        return { rows: [row] };
      }

      // --- crs_results (AX-07 snapshot diff) ---
      if (/FROM crs_results WHERE id/.test(sql)) {
        const row = crsResults.find((r) => r.id === params[0]);
        return { rows: row ? [{ result: row.result, id: row.id }] : [] };
      }
      if (/SELECT result, created_at FROM crs_results WHERE client_id/.test(sql)) {
        return {
          rows: crsResults
            .filter((r) => r.client_id === params[0])
            .map((r) => ({ result: r.result, created_at: r.created_at || null }))
        };
      }

      // --- clients.outcome_tier lookup (product-path routing, Rule 4) ---
      if (/SELECT outcome_tier FROM clients WHERE id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        return { rows: c ? [{ outcome_tier: c.outcome_tier || null }] : [] };
      }

      // --- clients.custom_fields claim (empty-field lock) ---
      if (/UPDATE clients/.test(sql) && /custom_fields->>/.test(sql) && /RETURNING id/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        const field = params[2];
        if (!c) return { rows: [] };
        if (c.custom_fields?.[field]) return { rows: [] };
        c.custom_fields = { ...(c.custom_fields || {}), ...JSON.parse(params[1]) };
        return { rows: [{ id: c.id }] };
      }

      // --- clients.custom_fields merge (mirrors src/handlers/client-lifecycle.mjs) ---
      if (/UPDATE clients SET custom_fields/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.custom_fields = { ...(c.custom_fields || {}), ...JSON.parse(params[1]) };
        return { rows: [] };
      }

      // --- clients.tags add (array union, mirrors `tags || $2::text[]` de-duped) ---
      if (/UPDATE clients SET tags = array\(SELECT DISTINCT unnest\(tags \|\|/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.tags = Array.from(new Set([...(c.tags || []), ...params[1]]));
        return { rows: [] };
      }
      // --- clients.tags remove ---
      if (/UPDATE clients SET tags = array\(SELECT unnest\(tags\) EXCEPT/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.tags = (c.tags || []).filter((t) => !params[1].includes(t));
        return { rows: [] };
      }

      // --- events (lead-temperature classification + bus emit) ---
      if (/SELECT COUNT\(\*\)/.test(sql) && /FROM events/.test(sql) && /booking\.created/.test(sql)) {
        const orgScoped = /org_id\s*=\s*\$1/.test(sql);
        const clientId = params[orgScoped ? 1 : 0];
        const includeRescheduled = /booking\.rescheduled/.test(sql);
        const n = events.filter((e) =>
          e.client_id === clientId
          && (!orgScoped || e.org_id === params[0])
          && (e.name === "booking.created" || (includeRescheduled && e.name === "booking.rescheduled"))
        ).length;
        return { rows: [{ n }] };
      }
      /* s-nobook-chase hasBooked — client id OR the email/phone carried in a
         historical event whose client_id is null. Mirrors the SQL exactly:
         same company, last-ten-digits phone compare, case-insensitive email,
         and the address fallbacks apply ONLY to a row with no customer on it —
         otherwise a housemate's stamped booking answers for this client. */
      if (/WITH me AS \(SELECT org_id, email, phone FROM clients/.test(sql)) {
        const clientId = params[0];
        const me = clients.find((c) => c.id === clientId);
        if (!me) return { rows: [] };
        const digits = (s) => String(s || "").replace(/\D/g, "");
        const myPhone = digits(me.phone);
        const hit = events.some((e) => {
          if (e.name !== "booking.created") return false;
          if (e.org_id && me.org_id && e.org_id !== me.org_id) return false;
          if (e.client_id && e.client_id === clientId) return true;
          if (e.client_id) return false;
          const p = e.payload || {};
          if (me.email && p.email
            && String(p.email).toLowerCase() === String(me.email).toLowerCase()) return true;
          if (myPhone.length >= 10 && digits(p.phone).slice(-10) === myPhone.slice(-10)) return true;
          return false;
        });
        return { rows: hit ? [{ booked: 1 }] : [] };
      }
      if (/SELECT DISTINCT name FROM events/.test(sql)) {
        const [clientId, names] = params;
        return { rows: events.filter((e) => e.client_id === clientId && names.includes(e.name)).map((e) => ({ name: e.name })) };
      }
      if (/INSERT INTO events/.test(sql)) {
        const [orgId, name, version, idem, clientId, payload] = params;
        if (idem && events.find((e) => e.org_id === orgId && e.idempotency_key === idem)) {
          return { rows: [] }; // ON CONFLICT DO NOTHING
        }
        const id = "evt-" + ++n;
        events.push({
          id, org_id: orgId, name, version, idempotency_key: idem,
          client_id: clientId, payload
        });
        return { rows: [{ id }] };
      }
      // Card Stacking round emitter — latest / next round number
      if (/SELECT \* FROM funding_rounds[\s\S]*ORDER BY round_number DESC/.test(sql)) {
        const rounds = fundingRounds
          .filter((r) => r.org_id === params[0] && r.client_id === params[1])
          .sort((a, b) => b.round_number - a.round_number);
        return { rows: rounds[0] ? [rounds[0]] : [] };
      }
      if (/SELECT COALESCE\(MAX\(round_number\), 0\)/.test(sql)) {
        const rounds = fundingRounds.filter((r) => r.org_id === params[0] && r.client_id === params[1]);
        const max = rounds.reduce((m, r) => Math.max(m, Number(r.round_number) || 0), 0);
        return { rows: [{ max }] };
      }

      // --- message_templates prefix lookup (BS-01 grid cell -> real template_key) ---
      if (/SELECT template_key FROM message_templates/.test(sql)) {
        const [orgId, like] = params;
        const prefix = String(like).replace(/%$/, "");
        const hits = templates
          .filter((t) => t.org_id === orgId && t.compliance_passed && String(t.template_key).startsWith(prefix))
          .sort((a, b) => String(a.template_key).localeCompare(String(b.template_key)));
        return { rows: hits[0] ? [{ template_key: hits[0].template_key }] : [] };
      }

      // --- message_templates + messages (sendTemplated) ---
      if (/SELECT body,\s*subject(?:\s*,\s*compliance_passed)?[\s\S]*?FROM message_templates/.test(sql)) {
        const [orgId, key] = params;
        const t = templates.find((t) => t.org_id === orgId && t.template_key === key);
        return { rows: t ? [{ body: t.body, subject: t.subject || null, compliance_passed: !!t.compliance_passed }] : [] };
      }
      if (/INSERT INTO messages/.test(sql)) {
        const providerRef = params[5];
        if (providerRef && messages.find((m) => m.org_id === params[0] && m.provider_ref === providerRef)) return { rows: [] };
        messages.push({ org_id: params[0], client_id: params[1], channel: params[2], template_key: params[3], rendered_body: params[4], provider_ref: providerRef });
        return { rows: [] };
      }

      // --- tasks ---
      // Two select shapes now: the guard-select the workflows still do up front,
      // and the one src/lib/create-task.mjs does (which returns id, and also
      // dedupes on title when asked). Both are answered so a workflow patched to
      // call createTask behaves the same here as against Postgres.
      if (/SELECT 1 FROM tasks/.test(sql)) {
        const [clientId, sourceWorkflow, body] = params;
        return { rows: tasks.find((t) => t.client_id === clientId && t.source_workflow === sourceWorkflow && t.body === body) ? [{ x: 1 }] : [] };
      }
      if (/SELECT id FROM tasks/.test(sql)) {
        const [clientId, sourceWorkflow, key] = params;
        const byTitle = /AND title = \$3/.test(sql);
        const hit = tasks.find((t) =>
          t.client_id === clientId && t.source_workflow === sourceWorkflow &&
          (byTitle ? t.title === key : t.body === key));
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        // Two writer shapes, and they do NOT share a parameter order.
        //
        // src/lib/create-task.mjs writes assignee as a literal NULL in the
        // VALUES list, so it binds EIGHT params:
        //   0 org, 1 client, 2 title, 3 body, 4 due_at, 5 source_workflow,
        //   6 assignee_role, 7 assignee_staff_id
        //
        // The pre-041 callers (src/handlers/comms.mjs) bind assignee, giving
        // SEVEN with everything after it shifted by one:
        //   0 org, 1 client, 2 assignee, 3 title, 4 body, 5 due_at, 6 source
        //
        // Keyed off the column list rather than params.length, because a shape
        // that changes arity later should fail loudly here, not mis-map silently.
        const wide = /assignee_role/.test(sql);
        const row = wide ? {
          id: "task-" + (tasks.length + 1),
          org_id: params[0], client_id: params[1],
          title: params[2], body: params[3], due_at: params[4],
          source_workflow: params[5],
          assignee_role: params[6], assignee_staff_id: params[7],
          meeting_url: params[8] ?? null,
          done: false
        } : {
          id: "task-" + (tasks.length + 1),
          org_id: params[0], client_id: params[1],
          title: params[3], body: params[4], due_at: params[5],
          source_workflow: params[6],
          assignee_role: null, assignee_staff_id: null,
          done: false
        };
        // ON CONFLICT DO NOTHING against tasks_idempotency_idx
        // (client_id, source_workflow, body) NULLS NOT DISTINCT.
        const clash = tasks.find((t) => t.client_id === row.client_id &&
          t.source_workflow === row.source_workflow && t.body === row.body);
        if (clash) return { rows: [] };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }

      // --- funding_rounds: N-06 still-eligible check (funded_amount > 0) ---
      if (/SELECT 1 FROM funding_rounds WHERE client_id.*funded_amount/.test(sql)) {
        const match = fundingRounds.find((r) => r.client_id === params[0] && parseFloat(r.funded_amount) > 0);
        return { rows: match ? [{ x: 1 }] : [] };
      }
      // --- funding_rounds (latest round id-only lookup for allApplicationsDenied in F-09) ---
      if (/SELECT id FROM funding_rounds WHERE client_id/.test(sql)) {
        const rounds = fundingRounds.filter((r) => r.client_id === params[0]).sort((a, b) => b.round_number - a.round_number);
        return { rows: rounds[0] ? [{ id: rounds[0].id }] : [] };
      }
      // --- applications (per-bank status for F-09 allApplicationsDenied) ---
      if (/SELECT status FROM applications WHERE funding_round_id/.test(sql)) {
        const apps = applications.filter((a) => a.funding_round_id === params[0]);
        return { rows: apps.map((a) => ({ status: a.status })) };
      }
      // --- funding_rounds (latest round lookup + hold_reason set) ---
      if (/SELECT (?:id, )?hold_reason FROM funding_rounds/.test(sql)) {
        const rounds = fundingRounds.filter((r) => r.client_id === params[0]).sort((a, b) => b.round_number - a.round_number);
        return { rows: rounds[0] ? [{ id: rounds[0].id, hold_reason: rounds[0].hold_reason ?? null }] : [] };
      }
      if (/UPDATE funding_rounds SET hold_reason/.test(sql)) {
        const r = fundingRounds.find((r) => r.id === params[0]);
        if (r) r.hold_reason = params[1];
        return { rows: [] };
      }

      // --- inquiry_log create (C-02) ---
      if (/SELECT 1 FROM inquiry_log WHERE client_id/.test(sql)) {
        const [clientId, bureau, inquiryName] = params;
        return { rows: inquiryLog.find((r) => r.client_id === clientId && r.bureau === bureau && r.inquiry === inquiryName) ? [{ x: 1 }] : [] };
      }
      if (/INSERT INTO inquiry_log/.test(sql)) {
        inquiryLog.push({ org_id: params[0], client_id: params[1], bureau: params[2], inquiry: params[3], status: "New" });
        return { rows: [] };
      }

      // --- inquiry_log (F-05 cleanup gate) ---
      if (/UPDATE inquiry_log SET status/.test(sql)) {
        const [clientId, newStatus] = params;
        let updated = 0;
        inquiryLog.filter((r) => r.client_id === clientId && r.status !== newStatus && r.status !== "Removed")
          .forEach((r) => { r.status = newStatus; updated += 1; });
        return { rows: [], rowCount: updated };
      }

      return { rows: [] };
    }
  };
}

// fakeStep — pass-through Inngest step shim: run executes immediately (no
// durability/retries needed for a unit test), sleep is a no-op. Same shape as the
// real Inngest `step` object (step.run(id, fn), step.sleep(id, duration)) so the
// exact handler code under test also runs unmodified against real Inngest.
export function fakeStep() {
  return {
    run: (_id, fn) => fn(),
    sleep: async () => {},
    sleepUntil: async () => {}
  };
}

export const ev = (name, payload, extra = {}) => ({ id: "evt-x", orgId: "org-1", name, payload, ...extra });

/* withPanelReads — the reads the Client Control Panel works its step out from
   (src/fulfillment/client-step.mjs), answered for the clients in `inner.clients`.
   Everything else falls through to `inner.query`, so a real workflow can run
   against pgFake with the panel's answer scripted.

   `panelFor(clientId)` returns that file's signals:
     consent       "valid" | "none" | "throws"   (default "valid")
     realCrs       count of real credit reports  (default 0)
     inquiryCases  active inquiry-removal cases  (default [])
     card          { pipeline_key, stage_key } | null
   Client rows come from inner.clients as they stand at the moment of the read,
   so a write made earlier in the same run is seen. */
export function withPanelReads(inner, panelFor = () => ({})) {
  const clients = () => inner.clients || [];
  const find = (id) => clients().find((c) => c.id === id) || null;
  const panel = (id) => ({ consent: "valid", realCrs: 0, inquiryCases: [], card: null, ...(panelFor(id) || {}) });
  const wrapped = Object.create(inner);
  wrapped.query = async (sql, params = []) => {
    const text = String(sql);
    if (/SELECT org_id FROM clients WHERE id = \$1 LIMIT 1/.test(text)) {
      const c = find(params[0]);
      return { rows: c ? [{ org_id: c.org_id }] : [] };
    }
    if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(text)) {
      const c = find(params[0]);
      if (!c || c.org_id !== params[1]) return { rows: [] };
      return { rows: [{ tags: [], custom_fields: {}, outcome_tier: null, ...c }] };
    }
    if (/FROM crs_results/.test(text) && /is_demo/.test(text)) {
      const id = Array.isArray(params[1]) ? params[1][0] : params[0];
      const n = panel(id).realCrs;
      return { rows: n > 0 ? [{ client_id: id, n }] : [] };
    }
    if (/FROM client_consents/.test(text)) {
      const how = panel(params[1]).consent;
      if (how === "throws") throw new Error('relation "client_consents" is unreadable');
      if (how !== "valid") return { rows: [] };
      return { rows: [{ client_id: params[1], is_valid: true, revoked_at: null, granted_at: new Date("2026-01-01T00:00:00Z") }] };
    }
    if (/FROM inquiry_removal_cases/.test(text)) return { rows: panel(params[1]).inquiryCases };
    if (/FROM cards ca/.test(text)) {
      const id = Array.isArray(params[1]) ? params[1][0] : null;
      const card = panel(id).card;
      return { rows: card ? [{ client_id: id, ...card }] : [] };
    }
    if (/WHERE client_id = \$1 AND org_id = \$2/.test(text) &&
        /FROM (crs_results|tasks|funding_rounds|v_invoice_balance)\b/.test(text)) return { rows: [] };
    if (/FROM businesses/.test(text) && /client_id = \$1 AND org_id = \$2/.test(text)) return { rows: [] };
    if (/FROM (documents|dispute_responses|dispute_cases|dispute_letters|payment_links)\b/.test(text) &&
        /ANY\(\$2/.test(text)) return { rows: [] };
    return inner.query(sql, params);
  };
  return wrapped;
}
