/*
 * Duck Days trailer director.
 *
 * Runs inside the game page (opened with ?debug), drives the duck and camera
 * through a 30 second storyboard, renders it frame by frame at a fixed time
 * step, and posts every frame plus an offline-rendered soundtrack to
 * receiver.mjs. Because nothing depends on real time, the result is identical
 * on a fast or slow machine and in a tab that is not being painted.
 *
 *   DuckTrailer.preview(shot, seconds)   compose one frame for inspection
 *   await DuckTrailer.capture(from, to)  render + upload frames [from, to)
 *   await DuckTrailer.renderAudio()      render + upload the soundtrack
 *   DuckTrailer.dryRun(from, to)         replay the storyboard for its sound events only
 *                                        (to re-score an existing picture; no frames are saved)
 *   DuckTrailer.restore()                hand the game back
 */
(() => {
  const g = window.__DUCK_DAYS__;
  if (!g) throw new Error('Open the game with ?debug first.');

  const RECEIVER = 'http://127.0.0.1:4391';
  const FPS = 60;
  const W = 1920;
  const H = 1080;
  const PI = Math.PI;
  const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
  const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

  const glCanvas = g.renderer.domElement;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  /** 0 -> 1 -> 0 envelope: up over `fade` from `a`, down over `fade` to `b`. */
  const env = (t, a, b, fade = 0.5) => smooth(a, a + fade, t) * (1 - smooth(b - fade, b, t));

  // ---------------------------------------------------------------------------------------
  // Game control helpers
  // ---------------------------------------------------------------------------------------

  /** Steer toward a world heading whatever the camera is doing (input is camera-relative). */
  function swim(heading, amount, dive = false) {
    const yaw = g.follow.yaw;
    const dx = Math.sin(heading);
    const dz = Math.cos(heading);
    g.debug.setIntents({
      moveZ: (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) * amount,
      moveX: (dx * Math.cos(yaw) + dz * -Math.sin(yaw)) * amount,
      dive,
    });
  }

  function place(x, z, heading) {
    g.debug.teleport(x, z, heading);
    g.follow.yaw = heading + PI;
  }

  function fixedView(pos, target, fov) {
    g.debug.view(pos, target);
    setFov(fov);
  }

  function followView(yaw, pitch, distance, fov) {
    g.debug.view(null);
    g.debug.look(yaw, pitch, distance);
    setFov(fov);
  }

  function setFov(fov) {
    const cam = g.follow.camera;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Simulates without capturing, so a shot opens with the wake already drawn. */
  function preroll(seconds, each) {
    const steps = Math.round(seconds * FPS);
    for (let i = 0; i < steps; i++) {
      if (each) each(i / FPS);
      g.debug.advance(1 / FPS, 1 / FPS);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Storyboard
  // ---------------------------------------------------------------------------------------

  const duck = () => g.duck.position;
  let anchor = { x: 0, z: 0 };
  const lead = { x: 0, y: 0, z: 0, set: false };

  const shots = [
    {
      // Water level, close: the wake spreads through the lily pads as the duck goes by.
      name: 'waterline',
      duration: 4.7,
      enter() {
        g.debug.setTimeScale(1);
        place(0.98, 3.2, PI);
        fixedView([-1.05, 0.115, -1.1], [0.6, 0.06, 0.6], 33);
        preroll(1.3, () => swim(PI, 0.5));
      },
      frame(t) {
        swim(PI, 0.5);
        const d = duck();
        // A slow pan that lets the duck travel through the frame rather than pinning it.
        const tz = lerp(0.9, -1.7, smooth(0.2, 4.7, t));
        fixedView([-1.05, 0.115, -1.1 - t * 0.04], [0.6, 0.07, lerp(tz, d.z, 0.5)], 33);
      },
    },
    {
      // Gameplay camera: gliding through the lily cove.
      name: 'lily',
      duration: 4.5,
      caption: ['Lily Cove', 'Pads, blooms and dragonflies'],
      enter() {
        g.debug.setTimeScale(1);
        const h = Math.atan2(0.2, -1);
        place(7.5, -1.5, h);
        followView(h + PI - 0.5, 0.3, 2.5, 46);
        preroll(1.6, () => swim(h, 0.45));
      },
      frame(t) {
        const h = Math.atan2(0.2, -1);
        followView(h + PI + lerp(-0.5, 0.4, smooth(0, 4.5, t)), lerp(0.3, 0.2, t / 4.5), lerp(2.5, 2.1, t / 4.5), 46);
        swim(h, 0.45);
      },
    },
    {
      // Tracking shot along the mossy log under the willow.
      name: 'willow',
      duration: 4.2,
      caption: ['Willow Shallows', 'Reeds, roots and a mossy log'],
      enter() {
        g.debug.setTimeScale(1);
        const h = Math.atan2(-0.95, -0.3);
        place(-2.0, -1.55, h);
        fixedView([-2.4, 0.3, 0.6], [-3.0, 0.1, -1.9], 40);
        preroll(1.4, () => swim(h, 0.5));
      },
      frame(t) {
        const h = Math.atan2(-0.95, -0.3);
        swim(h, 0.5);
        const d = duck();
        fixedView([d.x + 0.9, 0.24, d.z + 2.15], [d.x - 0.5, 0.3, d.z - 0.2], 40);
      },
    },
    {
      // Side on, half speed: head dips, tail lifts, and it is gone.
      name: 'dive',
      duration: 2.6,
      enter() {
        place(3.6, 4.3, -PI / 2);
        fixedView([2.75, 0.27, 5.85], [2.9, 0.07, 4.3], 36);
        g.debug.setTimeScale(1);
        preroll(0.9, () => swim(-PI / 2, 0.3));
        g.debug.setTimeScale(0.5);
      },
      frame(t) {
        const d = duck();
        swim(-PI / 2, 0.3, t > 0.45);
        fixedView([2.75, 0.27, 5.85], [lerp(2.9, d.x, 0.6), 0.05, 4.3], 36);
      },
    },
    {
      // Leading it across the deep pool: caustics on the silt, fish breaking away.
      name: 'beneath',
      duration: 3.4,
      continues: true,
      caption: ['The Deep Pool', 'Another world, a wingbeat down'],
      enter() {
        g.debug.setTimeScale(1);
        lead.set = false;
        preroll(0.55, () => swim(-PI / 2, 0.9, true));
      },
      frame(t) {
        // Bend from west to north-west, through the second shoal of fish.
        const h = lerp(-PI / 2, -2.42, smooth(0.0, 1.6, t));
        swim(h, 0.9, true);
        const d = duck();
        const fx = Math.sin(g.duck.heading);
        const fz = Math.cos(g.duck.heading);
        const ahead = lerp(2.3, 1.75, smooth(0, 3.4, t));
        const side = 0.75;
        const px = d.x + fx * ahead - fz * side * -1;
        const pz = d.z + fz * ahead + fx * side * -1;
        const floor = g.terrain.field.height(px, pz) + 0.2;
        const py = Math.max(floor, d.y - 0.12);
        // Ease the lens so the duck's small course changes do not shake it.
        if (!lead.set) {
          lead.x = px;
          lead.y = py;
          lead.z = pz;
          lead.set = true;
        }
        lead.x = lerp(lead.x, px, 0.12);
        lead.y = lerp(lead.y, py, 0.12);
        lead.z = lerp(lead.z, pz, 0.12);
        fixedView([lead.x, lead.y, lead.z], [d.x, d.y + 0.1, d.z], 48);
      },
    },
    {
      // From the bed, looking up: it lets go and rises toward the light.
      name: 'ascent',
      duration: 3.2,
      continues: true,
      enter() {
        g.debug.setTimeScale(1);
        lead.set = false;
      },
      frame(t) {
        const holding = t < 2.3;
        swim(-2.42, holding ? 0.8 : 0.25, holding);
        const d = duck();
        const fx = Math.sin(g.duck.heading);
        const fz = Math.cos(g.duck.heading);
        // Track alongside until it lets go, then stay put and tilt up after it.
        if (holding || !lead.set) {
          const px = d.x - fz * -1.55 - fx * 0.2;
          const pz = d.z + fx * -1.55 - fz * 0.2;
          const py = g.terrain.field.height(px, pz) + 0.16;
          if (!lead.set) {
            lead.x = px;
            lead.y = py;
            lead.z = pz;
            lead.set = true;
          }
          lead.x = lerp(lead.x, px, 0.1);
          lead.y = lerp(lead.y, py, 0.1);
          lead.z = lerp(lead.z, pz, 0.1);
        }
        fixedView([lead.x, lead.y, lead.z], [d.x + fx * 0.25, d.y + 0.16, d.z + fz * 0.25], 50);
      },
    },
    {
      // Back into the light: splash, rings, shake, quack.
      name: 'surface',
      duration: 3.3,
      continues: true,
      enter() {
        const d = duck();
        anchor = { x: d.x, z: d.z };
        g.debug.setIntents({});
        fixedView([anchor.x - 1.7, 0.3, anchor.z - 0.95], [anchor.x, 0.12, anchor.z], 36);
        g.debug.setTimeScale(1);
        // Run on until just before it breaks the surface, then slow down for the splash.
        let guard = 0;
        while (g.duck.position.y < -0.3 && guard++ < 240) g.debug.advance(1 / FPS, 1 / FPS);
        g.debug.setTimeScale(0.5);
      },
      frame(t) {
        g.debug.setIntents({});
        g.debug.setTimeScale(t < 1.5 ? 0.5 : 1);
        if (Math.abs(t - 1.55) < 0.5 / FPS) g.input.pressQuack();
        const d = duck();
        fixedView(
          [anchor.x - 1.7 + t * 0.03, 0.3, anchor.z - 0.95],
          [lerp(anchor.x, d.x, 0.5), 0.14, lerp(anchor.z, d.z, 0.5)],
          36
        );
      },
    },
    {
      // Wide and calm: one duck, one V on the water.
      name: 'title',
      duration: 4.1,
      enter() {
        g.debug.setTimeScale(1);
        const h = Math.atan2(0.72, -0.69);
        place(-1.9, 4.0, h);
        fixedView([-2.6, 0.85, 5.6], [2.6, 0.25, -1.6], 40);
        preroll(1.5, () => swim(h, 0.7));
      },
      frame(t) {
        const h = Math.atan2(0.72, -0.69);
        swim(h, 0.7);
        fixedView([-2.6 + t * 0.06, 0.85 + t * 0.05, 5.6], [2.6, 0.25, -1.6], 40);
      },
    },
  ];

  const starts = [];
  let total = 0;
  for (const s of shots) {
    starts.push(total);
    total += s.duration;
  }
  const FRAMES = Math.round(total * FPS);

  function shotAt(time) {
    let i = shots.length - 1;
    while (i > 0 && time < starts[i] - 1e-6) i--;
    return i;
  }

  // ---------------------------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------------------------

  function text(str, x, y, font, alpha, align = 'left', spacing = 0) {
    if (alpha <= 0.003) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.shadowColor = 'rgba(8, 16, 8, 0.6)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#f6f0dd';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function overlays(time) {
    const i = shotAt(time);
    const local = time - starts[i];
    const shot = shots[i];

    if (i === 0) {
      text('A SMALL NATURE DOCUMENTARY', 96, H - 104, `500 23px ${SANS}`, env(local, 1.0, 4.2, 0.7) * 0.92, 'left', 6);
    }
    if (shot.caption) {
      const a = env(local, 0.45, Math.min(shot.duration - 0.3, 3.6), 0.55);
      text(shot.caption[0], 96, H - 132, `italic 500 62px ${SERIF}`, a);
      text(shot.caption[1].toUpperCase(), 99, H - 92, `500 19px ${SANS}`, a * 0.85, 'left', 5);
    }
    if (shot.name === 'title') {
      // A soft band behind the title so it holds against bright foliage.
      const a = smooth(0.5, 1.5, local);
      const cy = H * 0.31;
      const band = ctx.createLinearGradient(0, cy - 200, 0, cy + 200);
      band.addColorStop(0, 'rgba(10,20,12,0)');
      band.addColorStop(0.5, `rgba(10,20,12,${0.34 * a})`);
      band.addColorStop(1, 'rgba(10,20,12,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, cy - 200, W, 400);
      text('Duck Days', W / 2, cy + 44, `italic 500 168px ${SERIF}`, a, 'center');
      text('PADDLE.  DIVE.  QUACK.', W / 2, cy + 112, `500 24px ${SANS}`, smooth(1.2, 2.1, local) * 0.92, 'center', 8);
    }

    // In from black, out to black.
    const black = Math.max(1 - smooth(0, 0.9, time), smooth(total - 0.75, total - 0.05, time));
    if (black > 0.003) {
      ctx.fillStyle = `rgba(0,0,0,${black})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Stepping, capture, audio
  // ---------------------------------------------------------------------------------------

  let prepared = false;
  let savedQuality = 'medium';
  let currentShot = -1;
  let recording = false;
  let videoTime = 0;
  const audioLog = { states: [], events: [] };
  const original = {};

  function prepare(picture = true) {
    if (prepared) return;
    prepared = true;
    g.debug.setRunning(false);
    savedQuality = g.snapshot().quality;
    if (picture) {
      g.setQuality('high');
      // 1920x1080 CSS pixels at the High preset's pixel ratio of 2: every output
      // pixel is a 2x2 supersample, which also resolves the dithered foliage.
      glCanvas.style.position = 'fixed';
      glCanvas.style.inset = 'auto';
      glCanvas.style.left = '0';
      glCanvas.style.top = '0';
      glCanvas.style.width = `${W}px`;
      glCanvas.style.height = `${H}px`;
      window.dispatchEvent(new Event('resize'));
    }

    // Record what the soundscape was asked to do, on the trailer's clock.
    const audio = g.audio;
    for (const fn of ['update', 'quack', 'paddle', 'splash', 'bubbles']) {
      original[fn] = audio[fn].bind(audio);
      audio[fn] = (...args) => {
        if (recording) {
          if (fn === 'update') audioLog.states.push({ t: videoTime, s: { ...args[1] } });
          else audioLog.events.push({ t: videoTime, fn, args });
        }
        return original[fn](...args);
      };
    }
  }

  function restore() {
    if (!prepared) return;
    prepared = false;
    for (const fn of Object.keys(original)) g.audio[fn] = original[fn];
    g.debug.setIntents(null);
    g.debug.view(null);
    g.debug.setTimeScale(1);
    setFov(52);
    for (const prop of ['position', 'inset', 'left', 'top', 'width', 'height']) glCanvas.style[prop] = '';
    g.setQuality(savedQuality);
    window.dispatchEvent(new Event('resize'));
    g.debug.teleport(1.0, 3.2, Math.atan2(-0.208, -0.978));
    g.debug.setRunning(true);
  }

  /** Advances the storyboard to frame `i` (must be called in order) and renders it. */
  function step(i) {
    const time = i / FPS;
    videoTime = time;
    const index = shotAt(time);
    if (index !== currentShot) {
      const wasRecording = recording;
      recording = false; // pre-roll is not part of the film
      shots[index].enter();
      recording = wasRecording;
      currentShot = index;
    }
    shots[index].frame(time - starts[index]);
    g.debug.advance(1 / FPS, 1 / FPS);
  }

  function compose(time) {
    ctx.drawImage(glCanvas, 0, 0, W, H);
    overlays(time);
  }

  function frameBytes() {
    const url = out.toDataURL('image/jpeg', 0.94);
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return bytes;
  }

  /** Renders one frame of a shot for inspection and shows it over the page. */
  function preview(shotIndex, seconds) {
    prepare();
    recording = false;
    currentShot = -1;
    // A shot that continues the previous one needs that one played first.
    let first = shotIndex;
    while (first > 0 && shots[first].continues) first--;
    const from = Math.round(starts[first] * FPS);
    const to = Math.round((starts[shotIndex] + seconds) * FPS);
    for (let i = from; i <= to; i++) step(i);
    compose(to / FPS);
    let img = document.getElementById('trailer-preview');
    if (!img) {
      img = document.createElement('img');
      img.id = 'trailer-preview';
      img.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:auto;z-index:1000;background:#000';
      document.body.appendChild(img);
    }
    img.src = out.toDataURL('image/jpeg', 0.9);
    return { shot: shots[shotIndex].name, frame: to, duck: g.snapshot().duck, camera: g.snapshot().camera };
  }

  /**
   * Loads the game's recorded clips before a run. The bill follows the syllables
   * of whichever quack recording plays, so the storyboard must not start on the
   * synthesised fallback and then be scored with the recording.
   */
  async function sounds() {
    g.audio.unlock();
    await g.audio.ready;
    return g.audio.recordedClips;
  }

  /** Renders and uploads frames [from, to). Call with consecutive ranges starting at 0. */
  async function capture(from = 0, to = FRAMES) {
    prepare();
    await sounds();
    if (from === 0) {
      currentShot = -1;
      audioLog.states.length = 0;
      audioLog.events.length = 0;
    }
    recording = true;
    const end = Math.min(to, FRAMES);
    for (let i = from; i < end; i++) {
      step(i);
      compose(i / FPS);
      const res = await fetch(`${RECEIVER}/frame?i=${i}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: frameBytes(),
      });
      if (!res.ok) throw new Error(`frame ${i}: ${res.status}`);
    }
    recording = false;
    return { done: end, of: FRAMES, events: audioLog.events.length };
  }

  /**
   * Steps the storyboard without rendering a film, just to log what the
   * soundscape is asked to do and when. The duck's motion is deterministic, so
   * the log lines up with a picture captured earlier. Call `await sounds()` first.
   */
  function dryRun(from = 0, to = FRAMES) {
    prepare(false);
    if (from === 0) {
      currentShot = -1;
      audioLog.states.length = 0;
      audioLog.events.length = 0;
    }
    recording = true;
    const end = Math.min(to, FRAMES);
    for (let i = from; i < end; i++) step(i);
    recording = false;
    return { done: end, of: FRAMES, events: audioLog.events.length };
  }

  /**
   * Replays the logged soundscape through a second AudioSystem attached to an
   * OfflineAudioContext, so the soundtrack is sample-accurate to the picture.
   */
  async function renderAudio() {
    const SR = 48000;
    const AudioSystem = g.audio.constructor;
    const RealContext = window.AudioContext;
    let offline = null;
    let resumeRender = null;
    window.AudioContext = function OfflineStandIn() {
      offline = new OfflineAudioContext(2, Math.ceil(SR * total), SR);
      resumeRender = offline.resume.bind(offline);
      Object.defineProperty(offline, 'state', { get: () => 'running' });
      offline.close = () => Promise.resolve();
      offline.resume = () => Promise.resolve();
      return offline;
    };
    const audio = new AudioSystem();
    audio.unlock();
    window.AudioContext = RealContext;
    if (!offline) throw new Error('offline context was not created');
    // Recorded clips load asynchronously; the render must not start without them.
    await audio.ready;

    const events = [...audioLog.events].sort((a, b) => a.t - b.t);
    const states = audioLog.states;
    const calm = { submersion: 0, speed: 0, duckUnder: false, breeze: 0.5, nearReeds: 0.2 };
    const tick = 1 / FPS;
    let cursor = 0;
    for (let i = 1; i < FRAMES; i++) {
      const t = i * tick;
      offline.suspend(t).then(() => {
        try {
          while (events.length && events[0].t <= t) {
            const e = events.shift();
            audio[e.fn](...e.args);
          }
          while (cursor < states.length - 1 && states[cursor + 1].t <= t) cursor++;
          audio.update(tick, states[cursor] ? states[cursor].s : calm);
        } finally {
          resumeRender();
        }
      });
    }
    const buffer = await offline.startRendering();

    // 16-bit stereo WAV with a short fade at each end to match the picture.
    const n = buffer.length;
    const wav = new DataView(new ArrayBuffer(44 + n * 4));
    const put = (o, s) => [...s].forEach((c, k) => wav.setUint8(o + k, c.charCodeAt(0)));
    put(0, 'RIFF');
    wav.setUint32(4, 36 + n * 4, true);
    put(8, 'WAVEfmt ');
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 2, true);
    wav.setUint32(24, SR, true);
    wav.setUint32(28, SR * 4, true);
    wav.setUint16(32, 4, true);
    wav.setUint16(34, 16, true);
    put(36, 'data');
    wav.setUint32(40, n * 4, true);
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const gain = smooth(0, 0.6, t) * (1 - smooth(total - 1.1, total - 0.05, t));
      const l = clamp(L[i] * gain, -1, 1);
      const r = clamp(R[i] * gain, -1, 1);
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      wav.setInt16(44 + i * 4, l * 32767, true);
      wav.setInt16(46 + i * 4, r * 32767, true);
    }
    const res = await fetch(`${RECEIVER}/audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: wav.buffer,
    });
    if (!res.ok) throw new Error(`audio: ${res.status}`);
    await fetch(`${RECEIVER}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: JSON.stringify({ seconds: total, frames: FRAMES, fps: FPS, events: audioLog.events }, null, 1),
    });
    return {
      seconds: n / SR,
      peakDb: +(20 * Math.log10(Math.max(peak, 1e-6))).toFixed(1),
      events: audioLog.events.length,
      recorded: audio.recordedClips,
    };
  }

  window.DuckTrailer = { shots, starts, total, FRAMES, FPS, preview, capture, dryRun, sounds, renderAudio, restore, prepare };
})();
