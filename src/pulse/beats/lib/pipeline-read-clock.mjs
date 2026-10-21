// A clock around the read box for the pipeline beats (pipeline-boards, pipeline-facts).
//
// The pipeline truth files read through run(fn) => fn(tx), tx.query(sql, params), the same shape the
// morning lanes hand them. Here tx.query is the read box with a clock: a read that would start too late,
// or takes too long, throws. The truth code turns a failed read into a skip with the reason, never a PASS,
// so a slow hour says "not judged" and ends on its own words before the beat's harness cuts it.
//
// No imports. No I/O of its own: it only calls the read function it is handed.

/** The beat's harness cuts at deadlineMs (10 s). The lane gets a little less. */
export const LANE_BUDGET_MS = 8500;
/** One read gets at most this long. */
export const READ_TIMEOUT_MS = 4000;

export function clockedRun(read, budgetMs = LANE_BUDGET_MS, eachMs = READ_TIMEOUT_MS) {
  const deadline = Date.now() + budgetMs;
  const query = async (sql, params) => {
    const left = deadline - Date.now();
    if (left <= 300) throw new Error("ran out of time before this read");
    let timer;
    try {
      return await Promise.race([
        read(sql, params),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("the read took too long")), Math.min(left, eachMs));
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return (fn) => fn({ query });
}
