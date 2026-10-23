#!/bin/zsh
# Lay the 8 see-through clips over the finished thank-you video in ONE encode. Audio is copied.
# Starts are the REAL times each anchor line is spoken (read from the burned-in captions).
set -e
FF=/Users/chrisstanbridge/.local/bin/ffmpeg
SRC="/Users/chrisstanbridge/Downloads/Direct Book Thank You Take 1 (Edited Pre Animation).mp4"
C=/private/tmp/claude-501/ty-overlay-out/clips
OUT=/private/tmp/claude-501/ty-overlay-out/thank-you-animation-TEST.mp4
# start seconds (real) and frames per clip, in play order
S=(4.3 10.8 18.1 24.5 31.5 37.0 43.7 50.9)
N=(90 75 105 90 75 120 75 90)
F=(01-BookCallWide 02-SoftPullWide 03-LenderMatchScrollWide 04-BureauMatchWide 05-QualifyTodayWide 06-ProofWallWide 07-PathCardsWide 08-StepPathWide)
ARGS=(-hide_banner -nostats -y -i "$SRC")
for f in $F; do ARGS+=(-i "$C/$f.mov"); done
G=""
prev="0:v"
for i in {1..8}; do
  sf=$(python3 -I -c "print(round(${S[$i]}*30))")
  fr=${N[$i]}
  from=$(python3 -I -c "print(f'{($sf-0.5)/30:.6f}')")
  to=$(python3 -I -c "print(f'{($sf+$fr-0.5)/30:.6f}')")
  G+="[$i:v]trim=end_frame=$fr,setpts=PTS-STARTPTS+$sf/(30*TB)[a$i];"
  G+="[$prev][a$i]overlay=x=0:y=0:eof_action=pass:enable='between(t,$from,$to)'[v$i];"
  prev="v$i"
  echo "clip $i ${F[$i]} start_frame=$sf ($(python3 -I -c "print(f'{$sf/30:.3f}')") s) frames=$fr"
done
G=${G%;}
$FF $ARGS -filter_complex "$G" -map "[$prev]" -map 0:a:0 \
  -c:v libx264 -preset medium -crf 15 -pix_fmt yuv420p -colorspace bt709 -color_range tv -r 30 \
  -c:a copy -movflags +faststart "$OUT"
