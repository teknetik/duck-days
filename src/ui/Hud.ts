import type { QualityLevel } from '../core/Quality';

export interface HudCallbacks {
  onMute(muted: boolean): void;
  onQuality(level: QualityLevel): void;
  onTouchMove(x: number, z: number): void;
  onTouchDive(active: boolean): void;
  onTouchQuack(): void;
}

/** Pointer capture can fail for a pointer that is already gone; the control still works without it. */
function capture(target: HTMLElement, pointerId: number) {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Ignore: release is also handled by pointerup / pointercancel.
  }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

/**
 * The few bits of interface there are: a title that fades once you swim, a
 * controls hint, area captions, mute, the quality switch, and touch controls
 * on phones. It only reflects state and emits intents.
 */
export class Hud {
  private readonly title = el('title');
  private readonly hint = el('hint');
  private readonly caption = el('caption');
  private readonly captionTitle = this.caption.querySelector('.caption-title') as HTMLElement;
  private readonly captionSub = this.caption.querySelector('.caption-sub') as HTMLElement;
  private readonly tint = el('tint');
  private readonly muteButton = el<HTMLButtonElement>('mute');
  private readonly settingsButton = el<HTMLButtonElement>('settings');
  private readonly panel = el('panel');
  private readonly loading = el('loading');
  private readonly qualityButtons: HTMLButtonElement[];
  private captionTimer = 0;
  private movedFor = 0;
  private introGone = false;
  private lastTint = -1;

  constructor(
    private readonly callbacks: HudCallbacks,
    initial: { muted: boolean; quality: QualityLevel }
  ) {
    this.qualityButtons = Array.from(this.panel.querySelectorAll<HTMLButtonElement>('button[data-quality]'));

    this.muteButton.addEventListener('click', () => {
      const muted = this.muteButton.getAttribute('aria-pressed') !== 'true';
      this.setMuted(muted);
      this.callbacks.onMute(muted);
    });

    this.settingsButton.addEventListener('click', () => this.togglePanel());
    for (const button of this.qualityButtons) {
      button.addEventListener('click', () => {
        const level = button.dataset.quality as QualityLevel;
        this.setQuality(level);
        this.callbacks.onQuality(level);
      });
    }
    // Clicking back into the pond, or Escape, puts the panel away.
    window.addEventListener('pointerdown', (e) => {
      if (this.panel.classList.contains('hidden')) return;
      const target = e.target as Node;
      if (!this.panel.contains(target) && !this.settingsButton.contains(target)) this.togglePanel(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.togglePanel(false);
    });
    // Buttons must not keep keyboard focus, or Space would re-press them instead of diving.
    for (const button of [this.muteButton, this.settingsButton, ...this.qualityButtons]) {
      button.addEventListener('keydown', (e) => {
        if (e.code === 'Space') e.preventDefault();
      });
      button.addEventListener('pointerup', () => button.blur());
    }

    this.setMuted(initial.muted);
    this.setQuality(initial.quality);
    this.setupTouch();
  }

  private togglePanel(open?: boolean) {
    const show = open ?? this.panel.classList.contains('hidden');
    this.panel.classList.toggle('hidden', !show);
    this.settingsButton.setAttribute('aria-expanded', String(show));
  }

  private setupTouch() {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (!coarse) return;
    document.body.classList.add('touch');
    const touch = el('touch');
    touch.classList.remove('hidden');
    touch.setAttribute('aria-hidden', 'false');

    const stick = el('stick');
    const knob = el('stick-knob');
    let active: number | null = null;
    const move = (e: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      const max = rect.width * 0.36;
      let dx = e.clientX - (rect.left + rect.width / 2);
      let dy = e.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const x = dx / max;
      const z = -dy / max;
      // A small dead zone so a resting thumb does not creep.
      this.callbacks.onTouchMove(Math.abs(x) < 0.12 ? 0 : x, Math.abs(z) < 0.12 ? 0 : z);
    };
    const release = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      knob.style.transform = '';
      this.callbacks.onTouchMove(0, 0);
    };
    stick.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      capture(stick, e.pointerId);
      move(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) move(e);
    });
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
    stick.addEventListener('lostpointercapture', release);

    const dive = el<HTMLButtonElement>('touch-dive');
    const setDive = (on: boolean) => {
      dive.classList.toggle('active', on);
      this.callbacks.onTouchDive(on);
    };
    dive.addEventListener('pointerdown', (e) => {
      capture(dive, e.pointerId);
      setDive(true);
    });
    dive.addEventListener('pointerup', () => setDive(false));
    dive.addEventListener('pointercancel', () => setDive(false));
    dive.addEventListener('lostpointercapture', () => setDive(false));

    const quack = el<HTMLButtonElement>('touch-quack');
    quack.addEventListener('pointerdown', () => this.callbacks.onTouchQuack());
  }

  setMuted(muted: boolean) {
    this.muteButton.setAttribute('aria-pressed', String(muted));
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  }

  setQuality(level: QualityLevel) {
    for (const button of this.qualityButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.quality === level));
    }
  }

  /** First frame is on screen. */
  ready() {
    this.loading.classList.add('done');
  }

  fail(message: string) {
    this.loading.classList.remove('done');
    this.loading.classList.add('error');
    this.loading.textContent = message;
  }

  showCaption(title: string, subtitle: string) {
    this.captionTitle.textContent = title;
    this.captionSub.textContent = subtitle;
    this.caption.classList.remove('hidden');
    this.captionTimer = 4.2;
  }

  update(dt: number, state: { moving: boolean; submersion: number }) {
    // The title and the controls hint step aside once the player has clearly got going.
    if (!this.introGone) {
      if (state.moving) this.movedFor += dt;
      if (this.movedFor > 1.6) {
        this.introGone = true;
        this.title.classList.add('hidden');
        this.hint.classList.add('hidden');
      }
    }
    if (this.captionTimer > 0) {
      this.captionTimer -= dt;
      if (this.captionTimer <= 0) this.caption.classList.add('hidden');
    }
    const tint = Math.round(state.submersion * 20) / 20;
    if (tint !== this.lastTint) {
      this.lastTint = tint;
      this.tint.style.opacity = String(tint);
    }
  }

  get introVisible() {
    return !this.introGone;
  }
}
