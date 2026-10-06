#!/usr/bin/env python3
"""
Copy the real approvals into the Remotion project for the ProofFlood template.

    python3 marketing/broll/scripts/proof-flood-approvals.py

Sources (real only):
  marketing/landing-pages/slo/client-wins/deck.json + deck/<id>.jpg
      36 verified crops, each with the amount read off the crop and its lender
      and product. 35 are used. d-50k-loc is left out: it is the same bank app
      and the same "Commercial Line of Credit" with a $50,000 limit as the
      KeyBank line below, so it may be the same account, and the running total
      must never count one approval twice.
  marketing/broll/public/proof-wall/<id>.png  (Unit D's copies of the branded
      win cards, with Unit D's extra blurs) + approvals-manifest.json
      10 more approvals whose amount and lender the manifest reads off the
      picture and that are not repeats of a deck.json crop. Only the
      screenshot inside each card is used (the card's own header and footer
      are cut away; the template draws its own card).
  The KeyBank line of credit (deck page 37): the screenshot inside
      proof-wall/win-noamount-keybank-p37-1.png. The picture carries the
      caption "$50k Business Line Of Credit Approval" and the deck page and
      AMOUNTS.md list it as "$50,000 KeyBank business line of credit", half of
      that page's "$100,000 KeyBank" total. The bank's own figure on the
      screen is "$49,764.00 Available Balance" (the manifest's note), so the
      amount comes from the picture's caption and the deck page.

Left out on purpose (possible repeats or totals, so the running total stays
honest): the win cards that repeat a deck.json crop (Truist 20k, Highland 25k,
KeyBank 50k card, Chase 50k, Chase 74k), the second BankUnited 16k and the
second Bank of America 12k, chat totals ($70k, "$45,000 ... in 3 days" FNBO),
chat lines with no lender (10k, 10k, 15k, 25k), "14k" Chase (may be the
$13,800 Chase Freedom), "chase for 45", and the U.S. Bank $5,000 whose
digit is soft.

Writes:
  marketing/broll/public/proof-flood/<id>.jpg
  marketing/broll/src/templates/proofFloodApprovals.ts  (generated list)

Nothing is added to any picture and no amount is changed.
"""
import json
import shutil
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
BROLL = HERE.parent
REPO = BROLL.parent.parent
WINS = REPO / "marketing/landing-pages/slo/client-wins"
DECK_JSON = WINS / "deck.json"
DECK = WINS / "deck"
MANIFEST = WINS / "approvals-manifest.json"
PROOF_WALL = BROLL / "public/proof-wall"
OUT = BROLL / "public/proof-flood"
TS = BROLL / "src/templates/proofFloodApprovals.ts"

SKIP_DECK = {"d-50k-loc"}

# Win cards used for their inner screenshot: id -> product line (None when the picture names none).
WIN_EXTRAS = {
    "win-16000-bankunited": None,
    "win-12000-bank-of-america-2": "Business credit card",
    "win-25000-umpqua-bank": "Visa Business Card",
    "win-7500-pnc": "Business credit card",
    "win-5000-nihfcu": None,
    "win-10000-u-s-bank": "Credit card",
    "win-25000-enterprise-bank-trust": None,
    "win-9000-southstate": "Visa Business Card",
    "win-7000-citizens": "Everyday Points Business MasterCard",
    "win-15000-fnbo": "0% business credit",
}

KEYBANK_LOC = {
    "id": "keybank-50k-loc",
    "from": "win-noamount-keybank-p37-1",
    "amount": 50000,
    "lender": "KeyBank",
    "product": "Business line of credit",
    "source": "Canva Client Wins deck page 37 (KeyBank), screenshot inside proof-wall/win-noamount-keybank-p37-1.png",
    "note": "amount from the picture's caption '$50k Business Line Of Credit Approval' and deck page 37; the screen itself shows $49,764.00 available balance",
    # Keep the KeyBank words at the top, drop the yellow edge of the old "$100K" headline.
    "top": 455,
}

BORDER = (228, 228, 231)
PAD = (246, 246, 247)


def inner_box(im: Image.Image):
    """The screenshot inside a branded win card: inside the light frame, inside its 16 px padding."""
    px = im.convert("RGB").load()
    w, h = im.size
    # The frame's left padding strip runs down x=67 from just under the frame's top border to just above its bottom border.
    runs, start = [], None
    for y in range(h):
        if px[67, y] == PAD:
            start = y if start is None else start
        elif start is not None:
            runs.append((start, y - 1))
            start = None
    ys, ye = max(runs, key=lambda r: r[1] - r[0])
    border_rows = [y for y in range(h) if px[200, y] == BORDER]
    top = min(border_rows, key=lambda y: abs(y - ys) if y <= ys + 4 else 9999)
    bottom = min(border_rows, key=lambda y: abs(y - ye) if y >= ye - 4 else 9999)
    # Frame border 2 px + padding 16 px; shave 2 more px so no frame edge shows.
    return (78, top + 20, 1042, bottom - 18)


def save_jpg(im: Image.Image, dst: Path) -> None:
    im.convert("RGB").save(dst, "JPEG", quality=92, optimize=True)


def main() -> None:
    deck = json.loads(DECK_JSON.read_text())["cards"]
    manifest = {m["id"]: m for m in json.loads(MANIFEST.read_text())}
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []

    for c in deck:
        if c["id"] in SKIP_DECK:
            continue
        src = REPO / c["crop"]
        dst = OUT / f"{c['id']}.jpg"
        shutil.copyfile(src, dst)
        w, h = Image.open(dst).size
        rows.append(
            {
                "id": c["id"],
                "width": w,
                "height": h,
                "amount": c["amount_dollars"],
                "lender": None if c["lender"] == "unnamed" else c["lender"],
                "product": c["product"],
                "source": f"deck.json {c['id']}: {c['amount_text_on_crop']}",
            }
        )

    for wid, product in WIN_EXTRAS.items():
        m = manifest[wid]
        assert m["amount"], wid
        im = Image.open(PROOF_WALL / f"{wid}.png")
        crop = im.crop(inner_box(im))
        dst = OUT / f"{wid}.jpg"
        save_jpg(crop, dst)
        rows.append(
            {
                "id": wid,
                "width": crop.width,
                "height": crop.height,
                "amount": m["amount"],
                "lender": m["lender"],
                "product": product,
                "source": f"approvals-manifest.json {wid}: {m['amount_note']}",
            }
        )

    k = KEYBANK_LOC
    im = Image.open(PROOF_WALL / f"{k['from']}.png")
    l, t, r, b = inner_box(im)
    crop = im.crop((l, max(t, k["top"]), r, b))
    save_jpg(crop, OUT / f"{k['id']}.jpg")
    rows.append(
        {
            "id": k["id"],
            "width": crop.width,
            "height": crop.height,
            "amount": k["amount"],
            "lender": k["lender"],
            "product": k["product"],
            "source": f"{k['source']}; {k['note']}",
        }
    )

    # Smallest first, climbing to the biggest (the deck's own order rule).
    rows.sort(key=lambda r: (r["amount"], r["id"]))
    total = sum(r["amount"] for r in rows)

    lines = [
        "// GENERATED by marketing/broll/scripts/proof-flood-approvals.py. Do not edit by hand.",
        f"// {len(rows)} real approvals, smallest first. Pictures in public/proof-flood/<id>.jpg.",
        "// `amount`, `lender` and `product` come from deck.json or approvals-manifest.json (read off each",
        "// picture); `lender` is null when the picture names no lender. `source` says where each figure is read.",
        f"// Sum of every amount: {total} (the running total when all of them are on screen).",
        "",
        "export type FloodApproval = {",
        "  id: string;",
        "  width: number;",
        "  height: number;",
        "  amount: number;",
        "  lender: string | null;",
        "  product: string | null;",
        "  source: string;",
        "};",
        "",
        "export const FLOOD_APPROVALS: FloodApproval[] = [",
    ]
    for r in rows:
        lines.append(
            "  {"
            f"id: {json.dumps(r['id'])}, width: {r['width']}, height: {r['height']}, amount: {r['amount']}, "
            f"lender: {json.dumps(r['lender'])}, product: {json.dumps(r['product'])}, source: {json.dumps(r['source'], ensure_ascii=False)}"
            "},"
        )
    lines += ["];", "", f"export const FLOOD_TOTAL = {total};", ""]
    TS.write_text("\n".join(lines))
    print(f"{len(rows)} approvals, total ${total:,} -> {OUT.relative_to(REPO)} and {TS.relative_to(REPO)}")


if __name__ == "__main__":
    main()
