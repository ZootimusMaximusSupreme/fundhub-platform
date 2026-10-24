"""anchors.json: his words (whisper small.en times, words-timeline.txt) that each animation lands on. python3 -I tools/anchors.py"""
import json, os
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = {
 1: [("$20,000", 2.55), ("$400,000", 3.89), ("even a million", 5.16), ("plus personal funding", 7.2)],
 2: [("your personal data", 12.06), ("your business codes", 13.02)],
 3: [("800 scores", 14.62), ("from the maximum amount of funding", 15.37)],
 4: [("Fundhub (I run Fundhub)", 21.54)],
 5: [("a little over a million dollars for myself", 24.19)],
 6: [("a bank denies you", 26.75), ("nobody checks your file against what that bank approves", 28.83)],
 7: [("two approvals", 36.07), ("hard inquiries", 37.71)],
 8: [("you skip applying", 39.26), ("you never find out what you qualify for", 41.36)],
 9: [("Nobody checks your file", 45.6), ("against what each bank approves", 46.72)],
 10: [("UnderwriteIQ", 51.27), ("fix them first", 54.78)],
 11: [("thousands of lenders", 57.65), ("30 to 50", 59.1)],
 12: [("we apply in funding rounds", 60.52), ("in the order that protects your score", 61.82)],
 13: [("credit cards", 64.04), ("lines of credit", 66.64), ("SBA loans", 67.44), ("merchant cash advances", 67.9), ("personal funding", 69.27), ("stacked together at the lowest rates", 70.09)],
 14: [("every application leaves a hard inquiry", 73.52), ("the next lender approves less", 78.08), ("or just denies you", 79.73)],
 15: [("we remove the inquiries between every round", 80.98), ("your file goes into each round clean", 83.39)],
 16: [("a funding sequence runs three to six rounds", 85.68), ("builds real capital", 88.13)],
 17: [("aiming for 250K to 400,000", 93.77)],
 18: [("Fundhub (has a solution for that phase)", 101.34)],
 19: [("within 24 hours", 106.96), ("within 72", 109.42), ("you don't pay", 112.35)],
 20: [("something on your report is holding you back", 113.28), ("we show you exactly what it is", 115.33)],
 21: [("13 optimization points", 124.45), ("in the order that actually gets you funded", 125.73)],
 22: [("which balances to bring down", 128.84), ("which negative items to get removed", 130.58), ("what to add to your file", 132.39)],
 23: [("which banks to build relationships with", 135.43), ("where to keep your deposits", 137.45), ("your business data", 139.48), ("so banks see a company they can trust", 140.49)],
 24: [("Every step comes with a timeline", 142.63), ("you see your fundability climb", 145.32), ("towards the maximum", 146.81)],
 25: [("We guarantee", 153.12), ("the last tool you'll ever need", 153.89)],
 26: [("hundreds of files", 159.91), ("thousands of data points", 161.19)],
 27: [("Click the button below", 165.9), ("fill out the 10 second application", 167.0), ("pick a time for your call", 168.84)],
 28: [("a three bureau report", 172.12), ("You pay $32", 173.14), ("no impact on your score", 174.49)],
 29: [("how much you qualify for", 176.53), ("where you're at right now", 177.74), ("the maximum amount of funding", 181.41)],
 30: [("Click the link below", 187.46), ("book your call today", 188.28)],
}
plan = json.load(open(os.path.join(D, "plan.json")))
out = [{"n": c["n"], "template": c["template"], "start_s": c["start_s"], "his_words": [{"phrase": p, "word_start_s": t} for p, t in A[c["n"]]]} for c in plan]
json.dump({"video": "Direct Book VSL 1 - Watch page", "word_times": "whisper small.en (credentials/hormozi-kb-work), words-timeline.txt", "anchors": out}, open(os.path.join(D, "anchors.json"), "w"), indent=1, ensure_ascii=False)
print(len(out), "anchors")
