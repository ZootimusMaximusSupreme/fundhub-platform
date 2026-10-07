// An in-memory stand-in for ./store.mjs — the same calls, kept in an array.
//
// IT EXISTS FOR TWO CALLERS, and for nothing in the product:
//   * run.test.mjs, so the daily pass is driven with no database; and
//   * scripts/blueprint-file-alerts-dry-run.mjs, which proves what the pass WOULD
//     send for a real client BEFORE migration 471 is live — the real tables do not
//     exist on the live database yet, so the pass is run against this, while every
//     read of the client's accounts, cycles and credit pulls is still the real one.
//
// It keeps the two rules the database keeps, so a pass cannot behave differently
// here than there: one row per dedupe key, and one OPEN cash alert per cash kind.
// (The database's own enforcement of both is proved in store.pg.test.mjs.)

export function createMemoryStore({ settings = {}, csm = null } = {}) {
  const state = {
    settings: { payment_timing: true, promo_end: true, cash_reserve: true, new_credit: true, ...settings },
    alerts: [],
    csm
  };
  return {
    state,
    get alerts() { return state.alerts; },

    async readSettings() { return { ...state.settings, saved: true, updated_by_kind: null, updated_at: null }; },

    async recentKeys() { return new Set(state.alerts.map((a) => a.key)); },

    async newCreditLast4() {
      return new Set(state.alerts
        .filter((a) => a.kind === "new_credit")
        .flatMap((a) => (a.detail?.items || []).map((i) => i.last4).filter(Boolean)));
    },

    async recordAlert(_conn, a) {
      if (state.alerts.some((x) => x.key === a.key)) return { created: false, id: null };
      if (a.kind === "cash_reserve"
        && state.alerts.some((x) => x.kind === "cash_reserve" && x.cashKind === a.cashKind && !x.clearedAt)) {
        return { created: false, id: null };
      }
      const row = { ...a, id: `alert-${state.alerts.length + 1}`, clearedAt: null };
      state.alerts.push(row);
      return { created: true, id: row.id };
    },

    async reserveState() {
      const open = new Map();
      const episodes = new Map();
      for (const a of state.alerts.filter((x) => x.kind === "cash_reserve")) {
        episodes.set(a.cashKind, (episodes.get(a.cashKind) || 0) + 1);
        if (!a.clearedAt) open.set(a.cashKind, { id: a.id });
      }
      return { open, episodes };
    },

    async clearReserve(_conn, { id, at }) {
      const a = state.alerts.find((x) => x.id === id && !x.clearedAt);
      if (!a) return false;
      a.clearedAt = at;
      return true;
    },

    async assignedCsm() { return state.csm; }
  };
}

export default createMemoryStore;
