// A stand-in for how Inngest runs a durable function, for workflow tests that wait.
// Not a test file itself (no ".test." in the name) — node --test won't pick it up.
//
// Inngest does not run a workflow once from top to bottom. It runs it from the top,
// does the first step it has not done, records the step's answer, and starts again
// from the top with every finished step handed back from the record. A sleep ends the
// run for now; a later invocation wakes at the time the sleep asked for. So here:
//
//   - every run has its own record. step.run answers from it when it can, and what it
//     returns has been through JSON, exactly as a recorded answer has (a Date comes
//     back as text);
//   - step.sleepUntil ends the invocation (Suspend). runAll() moves ONE shared clock to
//     the next wake time of ANY run, fires whatever was scheduled to happen at that
//     moment, and invokes that run again from the top.
//
// Anything a function works out OUTSIDE a step is therefore worked out again against the
// later clock on every wake, which is the mistake s-04b-booking-reminders.mjs explains
// at length. Several runs share the clock, so a second opt-in can land while the first
// run is asleep, as it does in life.
//
// Only step.run and step.sleepUntil are modelled; add the others when a workflow needs them.

export class Suspend extends Error {
  constructor(id, until) { super(`suspended at ${id}`); this.id = id; this.until = until; }
}

const roundTrip = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export function inngestSim(startIso) {
  let t = Date.parse(startIso);
  const timers = [];
  const sleeps = [];
  const runs = new Map();

  // A timer's function may be async (it can write to a database); it runs at its own time.
  const fireUpTo = async (until) => {
    for (const x of timers.filter((y) => !y.done && y.at <= until).sort((a, b) => a.at - b.at)) {
      x.done = true;
      t = Math.max(t, x.at);
      await x.fn();
    }
  };
  const stepFor = (memo) => ({
    async run(id, fn) {
      if (memo.has(id)) return memo.get(id);
      const out = roundTrip(await fn());
      memo.set(id, out);
      return out;
    },
    async sleepUntil(id, when) {
      if (memo.has(id)) return;
      throw new Suspend(id, new Date(when).getTime());
    }
  });
  async function invoke(run) {
    try {
      run.result = await run.fn(stepFor(run.memo));
      run.done = true;
    } catch (err) {
      if (!(err instanceof Suspend)) throw err;
      sleeps.push({ key: run.key, id: err.id, until: new Date(err.until).toISOString() });
      run.memo.set(err.id, "slept");
      run.wake = err.until;
    }
  }

  return {
    now: () => t,
    /** Every sleep any run went to, in order: { key, id, until }. */
    sleeps,
    /** Make something happen at a clock time, while the runs are asleep. */
    at(iso, fn) { timers.push({ at: Date.parse(iso), fn, done: false }); },
    /** Move the clock without waking anything, as a server that was down would see it. */
    jump(ms) { t += ms; },
    /** Start runs ({ key, at, fn(step) }) and drive them all, in time order, until each is done. */
    async runAll(specs) {
      for (const s of specs) {
        runs.set(s.key, { key: s.key, fn: s.fn, memo: new Map(), wake: Date.parse(s.at), done: false, result: undefined });
      }
      for (;;) {
        const next = [...runs.values()].filter((r) => !r.done).sort((a, b) => a.wake - b.wake)[0];
        if (!next) break;
        await fireUpTo(next.wake);
        t = Math.max(t, next.wake);
        await invoke(next);
      }
      return specs.map((s) => runs.get(s.key).result);
    },
    /** Run a finished run's function again from the top, with its record, on the clock as it is now. */
    async replay(key) {
      const run = runs.get(key);
      run.done = false;
      for (;;) {
        await invoke(run);
        if (run.done) return run.result;
        await fireUpTo(run.wake);
        t = Math.max(t, run.wake);
      }
    }
  };
}
