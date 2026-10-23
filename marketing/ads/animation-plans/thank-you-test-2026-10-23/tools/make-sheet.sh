#!/bin/zsh
# Contact sheet: one frame per animation (middle of each), from the TEST video, 2 columns x 4 rows.
# Red box = the side panel the animation may use. Orange box = where the burned-in captions sit.
set -e
FF=/Users/chrisstanbridge/.local/bin/ffmpeg
T=/private/tmp/claude-501/ty-overlay-out/thank-you-animation-TEST.mp4
W=/private/tmp/claude-501/ty-overlay-out/work/test
FONT="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
mkdir -p $W
mid=(5.8 12.05 19.85 26.0 32.75 39.0 44.95 52.4)
name=(BookCallWide SoftPullWide LenderMatchScrollWide BureauMatchWide QualifyTodayWide ProofWallWide PathCardsWide StepPathWide)
side=(LEFT RIGHT LEFT RIGHT LEFT LEFT RIGHT LEFT)
px=(128 1560 128 1560 128 128 1560 128)
start=(4.3 10.8 18.1 24.5 31.5 37.0 43.7 50.9)
len=(3.0 2.5 3.5 3.0 2.5 4.0 2.5 3.0)
for i in {1..8}; do
  $FF -hide_banner -loglevel error -y -ss ${mid[$i]} -i $T -frames:v 1 $W/raw_$i.png
  $FF -hide_banner -loglevel error -y -i $W/raw_$i.png -vf "drawbox=x=${px[$i]}:y=72:w=872:h=936:color=red:t=6,drawbox=x=64:y=1170:w=2432:h=110:color=orange:t=4,drawbox=x=0:y=1380:w=2560:h=60:color=black@0.7:t=fill,drawtext=fontfile='$FONT':text='$i  ${name[$i]}  ${side[$i]}  starts ${start[$i]}s  length ${len[$i]}s  (frame at middle)':fontcolor=white:fontsize=40:x=24:y=1392,drawtext=fontfile='$FONT':text='$i':fontcolor=red:fontsize=120:x=24:y=16:box=1:boxcolor=white@0.85:boxborderw=10,scale=1280:720" -frames:v 1 $W/cell_$i.png
done
$FF -hide_banner -loglevel error -y -framerate 1 -start_number 1 -i $W/cell_%d.png -vf tile=2x4 -frames:v 1 /private/tmp/claude-501/ty-overlay-out/contact-sheet.png
ls -la /private/tmp/claude-501/ty-overlay-out/contact-sheet.png
