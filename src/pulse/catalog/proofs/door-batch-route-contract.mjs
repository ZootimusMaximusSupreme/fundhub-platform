export const ROUTE_CONTRACT_EVIDENCE =
  "src/pulse/catalog/proofs/door-batch-route-contract.mjs " +
  "src/pulse/catalog/proofs/door-batch-route-contract.test.mjs";

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

export async function evaluateRouteContract({ handler, request, deps, expected }) {
  const response = responseRecorder();
  await handler(request, response, deps);
  const problems = [];

  if (response.statusCode !== expected.status) problems.push(`status ${response.statusCode}`);
  for (const [name, value] of Object.entries(expected.body || {})) {
    if (response.body?.[name] !== value) problems.push(`body.${name}`);
  }
  for (const [name, value] of Object.entries(expected.headers || {})) {
    if (response.headers[name.toLowerCase()] !== value) problems.push(`header ${name}`);
  }

  return { ok: problems.length === 0, problems, response };
}

const ASSERTIONS = new Map([
  [
    "route:climate/config",
    "GET climate/config returns the browser map key and apply URL with public CORS; no record is written",
  ],
  [
    "route:public/rb2b-webhook",
    "GET public/rb2b-webhook returns the no-write service check without a secret",
  ],
]);

export function routeContractProof(row) {
  const assertion = ASSERTIONS.get(row?.surface);
  if (!assertion || !["none", "staffOnly"].includes(row?.impact)) return null;
  return { depth: "e2e", evidence: ROUTE_CONTRACT_EVIDENCE, asserts: assertion };
}
