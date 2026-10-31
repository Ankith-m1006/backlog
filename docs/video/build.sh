#!/usr/bin/env bash
# Silent cut with burned-in captions. Durations follow VOICEOVER.md; retime once the MP3 is in.
set -e
cd "$(dirname "$0")"
LC=$(python -c "import json;print(json.load(open('marks-live.json'))['chat'])")
LV=$(python -c "import json;print(json.load(open('marks-live.json'))['control'])")
RC=$(python -c "import json;print(json.load(open('marks-replay.json'))['control'])")
RO=$(python -c "import json;print(json.load(open('marks-replay.json'))['overlay'])")
F="-r 30 -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 20 -an"
CAP="drawtext=fontfile='C\:/Windows/Fonts/consola.ttf':textfile=caps/CAPFILE:fontsize=21:fontcolor=0xF4F1EA:box=1:boxcolor=0x16130F@0.86:boxborderw=12:x=(w-text_w)/2:y=h-58"
cap(){ echo "${CAP/CAPFILE/$1}"; }
card(){ ffmpeg -y -v error -framerate 30 -loop 1 -t $2 -i $1 -vf "scale=1280:720,$(cap $3)" $F $4; }
# live split: Twitch chat (400) | control room (880); args: start end speed cap out
split(){ ffmpeg -y -v error -ss $1 -to $2 -i "$LC" -ss $1 -to $2 -i "$LV" -filter_complex "[0:v]scale=400:720,setpts=(PTS-STARTPTS)/$3[a];[1:v]scale=880:720,setpts=(PTS-STARTPTS)/$3[b];[a][b]hstack=inputs=2,fps=30,$(cap $4)" $F $5; }
clip(){ ffmpeg -y -v error -ss $2 -to $3 -i "$1" -vf "scale=1280:720,setpts=(PTS-STARTPTS)/$4,fps=30,$(cap $5)" $F $6; }
card card1.png 10 s01.txt v01.mp4            # 0:00 title
card card2.png 14 s02.txt v02.mp4            # 0:10 problem
split 7 59 2 s03.txt v03.mp4                 # 0:24 live chat arrives (26s)
split 59 70 1 s04.txt v04.mp4                # 0:50 merged ticket + match (11s)
split 69.5 77 1 s05.txt v05.mp4              # 1:01 Send -> bot reply (7.5s)
card card3.png 16 s06.txt v06.mp4            # 1:09 how it works
clip "$RC" 4 54 2 s07.txt v07.mp4            # 1:25 busy replay (25s)
clip "$RO" 26 38 1 s08.txt v08.mp4           # 1:50 overlay (12s)
card card4.png 14 s09.txt v09.mp4            # 2:02 never answers on its own
card card5.png 10 s10.txt v10.mp4            # 2:16 end card
ls v*.mp4 | sed "s/^/file '/;s/\$/'/" > list.txt
ffmpeg -y -v error -f concat -safe 0 -i list.txt -c copy backlog-silent.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 backlog-silent.mp4
