function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function changedWiredItems(current, prior = { items: [] }) {
  const before = new Map((prior.items || []).map((item) => [item.id, item]));
  return (current.items || []).filter((item) => {
    if (item.state !== "wired") return false;
    const old = before.get(item.id);
    return !old || JSON.stringify([old.state, old.proof, old.proofDepth, old.proofAsserts])
      !== JSON.stringify([item.state, item.proof, item.proofDepth, item.proofAsserts]);
  });
}

export function proofPlan(items) {
  return {
    rows: items.length,
    tests: unique(items.flatMap((item) => item.proof?.tests || [])),
    lanes: unique(items.flatMap((item) => item.proof?.lanes || [])),
    beats: unique(items.flatMap((item) => item.proof?.beats || [])),
  };
}

export function redByFamily(catalog) {
  return Object.entries((catalog.items || [])
    .filter((item) => item.state === "red")
    .reduce((out, item) => {
      out[item.family] = (out[item.family] || 0) + 1;
      return out;
    }, {}))
    .sort((a, b) => b[1] - a[1]);
}
