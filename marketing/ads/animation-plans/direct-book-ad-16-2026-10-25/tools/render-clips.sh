#!/bin/bash
# Render every clip in schedule.json as a full 1080x1920 see-through ProRes 4444, scale 1.
#   bash tools/render-clips.sh <clips_dir>
set -e
PLAN="$(cd "$(dirname "$0")/.." && pwd)"
KIT="$(cd "$PLAN/../../../broll" && pwd)"
OUT="$1"
mkdir -p "$OUT"
cd "$KIT"
python3 -c "import json;[print(c['template'],c['clip'],c['props']) for c in json.load(open('$PLAN/schedule.json'))['clips']]" |
while read -r tpl clip props; do
  echo "render $clip ($tpl)"
  REMOTION_UNCLAMP=1 npx remotion render src/index.ts "$tpl" "$OUT/$clip" --props="$PLAN/$props" \
    --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le --log=error < /dev/null
done
echo done
