# Trailer capture

`trailer/duck-days-trailer.mp4` is recorded from the game itself: a script
drives the duck and camera through a 30 second storyboard, the game is stepped
at a fixed 1/60 s and each frame is saved, and the soundtrack is rendered
offline from the game's own audio engine (recorded clips included) using the
events logged during the capture. Nothing depends on real time, so the result is the same on any
machine, and it works in a tab that is not being painted.

## Re-recording

Needs Node and `ffmpeg`.

```bash
npm run build && npm run preview -- --port 4273      # the game, production build
```

```bash
node tools/trailer/receiver.mjs /tmp/duck-trailer 4391   # receives frames + audio
```

Open `http://localhost:4273/?debug` and, in the browser console:

```js
const s = document.createElement('script');
s.src = 'http://127.0.0.1:4391/director.js';
document.head.appendChild(s);
// once loaded:
await DuckTrailer.capture();      // 1800 frames at 1920x1080 (rendered at 2x, downsampled)
await DuckTrailer.renderAudio();  // 30 s stereo WAV, sample-accurate to the picture
DuckTrailer.restore();            // hand the game back
```

Then:

```bash
tools/trailer/encode.sh /tmp/duck-trailer trailer/duck-days-trailer.mp4
```

To re-score an existing picture without re-rendering it (for example after
changing the sound):

```js
await DuckTrailer.sounds();
DuckTrailer.dryRun();
await DuckTrailer.renderAudio();
```

and then replace the audio stream with `ffmpeg -i old.mp4 -i audio.wav -map 0:v
-map 1:a -c:v copy -c:a aac new.mp4`. This only stays in sync if the storyboard
and the quack recordings are unchanged, because the bill follows the recording.

## Editing the storyboard

The shots are the `shots` array in `director.js`: each has a duration, an
`enter()` that places the duck and pre-rolls the water, and a `frame(t)` that
sets intents and the camera. `DuckTrailer.preview(shotIndex, seconds)` composes
a single frame and shows it over the page, which is the quick way to check a
change before a full capture.

| # | Shot | Seconds | What it shows |
| --- | --- | --- | --- |
| 1 | waterline | 4.7 | Water level: the mallard passes a lily bloom, wake spreading through the pads |
| 2 | lily | 4.5 | Gameplay camera through the lily cove |
| 3 | willow | 4.2 | Tracking past the mossy log under the willow |
| 4 | dive | 2.6 | Side on, half speed: head dips, tail lifts, gone |
| 5 | beneath | 3.4 | Across the deep pool: caustics, sunken branch, fish scattering |
| 6 | ascent | 3.2 | From the bed, looking up as it rises toward the light |
| 7 | surface | 3.3 | Half-speed splash and rings, then a quack |
| 8 | title | 4.1 | Wide: one duck, one V on the water |
