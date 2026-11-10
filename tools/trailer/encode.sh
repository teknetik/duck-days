#!/usr/bin/env bash
# Assembles captured frames + soundtrack into the trailer.
#   tools/trailer/encode.sh <work-dir> [output.mp4]
# CRF=19 gives a near-lossless master (about 190 MB); the default of 26 is about a quarter of that.
set -euo pipefail

WORK="${1:?usage: encode.sh <work-dir> [output.mp4]}"
OUT="${2:-trailer/duck-days-trailer.mp4}"
mkdir -p "$(dirname "$OUT")"

# The frames are full-range JPEGs; convert to broadcast-range BT.709 so players
# do not crush or wash out the greens.
ffmpeg -hide_banner -loglevel warning -y \
  -framerate 60 -i "$WORK/frames/frame_%05d.jpg" \
  -i "$WORK/audio.wav" \
  -vf "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p" \
  -c:v libx264 -preset slow -crf "${CRF:-26}" -profile:v high \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 192k \
  -movflags +faststart -shortest \
  "$OUT"

# A poster frame from the title card.
ffmpeg -hide_banner -loglevel warning -y -ss 28.4 -i "$OUT" -frames:v 1 -update 1 -q:v 2 "${OUT%.mp4}-poster.jpg"

ffprobe -hide_banner -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate \
  -of default=noprint_wrappers=1 "$OUT"
