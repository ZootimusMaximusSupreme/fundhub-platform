#!/bin/sh
# Show the part of a plan that belongs to one file.
# usage: sh show.sh dedupe|stale <part of the file name>
# example: sh show.sh dedupe fundhub-ad-editor
# It prints every "### <path>" section whose heading contains your words.
# For the stale plan, ALSO run: grep -n -F '<part of the file name>' stale-plan.md
# (the stale plan keeps its "archive whole file" table without ### headings).
set -e
plan="$(dirname "$0")/$1-plan.md"
[ -f "$plan" ] || { echo "no such plan: $plan (use dedupe or stale)"; exit 1; }
out=$(awk -v want="$2" '/^### /{p=(index($0,want)>0)} p' "$plan")
if [ -z "$out" ]; then
  echo "no edit planned for '$2' in the $1 plan."
  echo "It may still be the OWNER of a repeat. To see that, run: grep -n -F '$2' $plan"
else
  printf '%s\n' "$out"
fi
