# Michael Masterson — *The Architecture of Persuasion* (2009)

Text extract for Fundhub copy reference. AWAI, ISBN 978-0-9821500-0-9.

## Files

| File | What |
|------|------|
| `masterson-architecture-of-persuasion-2009.txt` | Full text layer from the PDF (searchable) |

## Source

- **Drive:** https://drive.google.com/file/d/18aTm2HUG1qiy4PrTUMQB6HLfT9HkrHCf/view
- **Scraped:** 2026-10-01 via `src/company-brain/pdf-text.mjs` + Drive OAuth (`createDriveClient`)

## Coverage

| Metric | Value |
|--------|--------|
| PDF pages | 111 |
| Pages with extractable text | 101 |
| Characters in `.txt` | 144,671 |
| OCR needed | No (native text PDF) |

**No text layer (image-only spreads):** pages 1 (cover), 88–92, 94–97. Page 6 is minimal (~14 chars). Page 93 and the rest carry the prose. Sample mail-package photos in the image spreads are not in the `.txt`.

## Re-run from Drive

```bash
node --env-file=.env <<'EOF'
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { driveConfigFromEnv, createDriveClient } from "./src/company-brain/index.mjs";
import { extractPdfText } from "./src/company-brain/pdf-text.mjs";

const FILE_ID = "18aTm2HUG1qiy4PrTUMQB6HLfT9HkrHCf";
const outTxt = "marketing/ads/reference/masterson-architecture-of-persuasion-2009.txt";
const client = createDriveClient(driveConfigFromEnv(process.env));
const buf = await client.downloadMedia(FILE_ID);
const { text } = await extractPdfText(buf);
mkdirSync("marketing/ads/reference", { recursive: true });
writeFileSync(outTxt, text);
console.log("wrote", outTxt, "chars", text.length);
EOF
```

## One-line map (book → Fundhub)

Envelope teaser → ad hook. Headline → landing above-the-fold. Lead → VSL/page opening. Sales argument → proof and mechanism. Close → offer and CTA. See thread scrape notes 2026-10-01.
