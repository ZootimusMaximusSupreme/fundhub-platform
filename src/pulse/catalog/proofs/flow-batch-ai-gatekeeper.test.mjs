import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { aiGateCheck } = require("../../../../vendor/underwriteiq-full/api/lite/ai-gatekeeper.js");

test("the live UnderwriteIQ gate prompt and runtime judge both report outcomes", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.UNDERWRITE_IQ_VISION_KEY;
  const requests = [];

  process.env.UNDERWRITE_IQ_VISION_KEY = "fake-openai-key";
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });
    const likely = requests.length === 2;
    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            likely_credit_report: likely,
            reason: likely ? "Experian report" : "Bank statement",
            suspected_bureaus: likely ? ["Experian"] : [],
          }),
        };
      },
    };
  };

  try {
    const rejected = await aiGateCheck(Buffer.from("not-a-report"), "bank.pdf");
    const accepted = await aiGateCheck(Buffer.from("credit-report"), "report.pdf");

    assert.deepEqual(rejected, {
      ok: false,
      reason: "Bank statement",
      suspected_bureaus: [],
    });
    assert.deepEqual(accepted, {
      ok: true,
      reason: "Experian report",
      suspected_bureaus: ["Experian"],
    });
    assert.equal(requests.length, 2);

    for (const request of requests) {
      assert.equal(request.url, "https://api.openai.com/v1/responses");
      assert.equal(request.body.model, "gpt-4o-mini");
      assert.equal(request.body.temperature, 0);
      assert.match(request.body.input[0].content, /strict classifier for a credit-report analyzer/i);
      assert.match(request.body.input[0].content, /Return STRICT JSON ONLY/);
      assert.equal(request.body.input[1].content[0].text, "Classify this PDF upload.");
      assert.match(request.body.input[1].content[1].file_data, /^data:application\/pdf;base64,/);
    }
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.UNDERWRITE_IQ_VISION_KEY;
    else process.env.UNDERWRITE_IQ_VISION_KEY = previousKey;
  }
});
