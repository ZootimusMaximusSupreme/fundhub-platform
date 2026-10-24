#!/bin/bash
# usage: tools/render-clips.sh <clips_dir> [keys...]   (run from anywhere). Renders each props/NN-Template.json at 3840x2160 (scale 1; scaled down when laid on), ProRes 4444 with alpha.
D="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$1"; shift
mkdir -p "$OUT"; cd "$D/../../../broll" || exit 1
keys=("$@"); [ ${#keys[@]} -eq 0 ] && keys=($(ls "$D/props" | sed 's/\.json$//'))
for k in "${keys[@]}"; do
  t="${k#*-}"; extra=""; [ "$t" = "ProofWallWide" ] && extra="--gl=angle"
  REMOTION_UNCLAMP=1 npx remotion render src/index.ts "$t" "$OUT/$k.mov" --props="$D/props/$k.json" --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le $extra --log=error 2>&1 | tail -2
  echo "done $k"
done
