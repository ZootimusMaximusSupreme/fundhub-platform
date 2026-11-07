// The wordmark copy in code must be the asset file, byte for byte.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WORDMARK_SVG, negateY, wordmarkPaths, wordmarkPdfPaths } from "./fundhub-wordmark.mjs";

const ASSET = fileURLToPath(new URL("../../public/assets/fundhub-wordmark.svg", import.meta.url));

test("the code copy is exactly public/assets/fundhub-wordmark.svg", () => {
  assert.equal(WORDMARK_SVG, fs.readFileSync(ASSET, "utf8"));
});

test("every shape of the mark is drawn, mirrored once for the PDF", () => {
  const paths = wordmarkPaths();
  assert.equal(paths.length, 8);
  assert.ok(paths.every((d) => d.startsWith("M")));
  assert.equal(wordmarkPdfPaths().length, paths.length);
  assert.ok(wordmarkPdfPaths()[0].startsWith("M 2780 -6905 c -101 23"));
});

test("negateY flips every y value, absolute or relative, and nothing else", () => {
  assert.equal(negateY("M10 20 c1 2 3 4 5 6 l-7 8 z m 1 -2 h5 v3"), "M 10 -20 c 1 -2 3 -4 5 -6 l -7 -8 z m 1 2 h 5 v -3");
  const once = negateY(wordmarkPaths()[1]);
  assert.equal(negateY(once).split(" ").map(Number).filter(Number.isFinite).join(","),
    wordmarkPaths()[1].match(/-?\d+(\.\d+)?/g).map(Number).join(","), "flipping twice gives the mark back");
  assert.throws(() => negateY("M0 0 a5 5 0 0 1 10 10"), /Unsupported path command a/);
});
