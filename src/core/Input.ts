/**
 * Collects raw keyboard / pointer / touch events and exposes them as game
 * intents. Nothing here knows about ducks or cameras.
 */
export interface Intents {
  /** -1 (left) .. 1 (right). */
  moveX: number;
  /** -1 (toward the camera) .. 1 (away from it). */
  moveZ: number;
  dive: boolean;
  /** Pixels of look-drag since the last frame. */
  lookX: number;
  lookY: number;
  /** Wheel / pinch zoom steps since the last frame (positive = further away). */
  zoom: number;
  dragging: boolean;
  /** True for exactly one frame when the quack key goes down. */
  quack: boolean;
  /** True for exactly one frame when the mute key goes down. */
  toggleMute: boolean;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class Input {
  private readonly down = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private zoom = 0;
  private quack = false;
  private mute = false;
  private dragPointer: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private readonly touchMove = { x: 0, z: 0 };
  private touchDive = false;
  /** Fired on the first key or pointer press, for unlocking audio. */
  onFirstGesture: (() => void) | null = null;
  private gestured = false;

  constructor(private readonly surface: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerup', this.onPointerUp);
    surface.addEventListener('pointercancel', this.onPointerUp);
    surface.addEventListener('lostpointercapture', this.onPointerUp);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private gesture() {
    if (this.gestured) return;
    this.gestured = true;
    this.onFirstGesture?.();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const handled = e.code in MOVE_KEYS || e.code === 'Space' || e.code === 'KeyQ' || e.code === 'KeyM';
    if (!handled) return;
    e.preventDefault();
    this.gesture();
    if (e.repeat) return;
    this.down.add(e.code);
    if (e.code === 'KeyQ') this.quack = true;
    if (e.code === 'KeyM') this.mute = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  /** Releases everything so a key held while the tab loses focus cannot stick. */
  private onBlur = () => {
    this.down.clear();
    this.dragPointer = null;
    this.touchMove.x = 0;
    this.touchMove.z = 0;
    this.touchDive = false;
  };

  private onPointerDown = (e: PointerEvent) => {
    this.gesture();
    if (this.dragPointer !== null) return;
    this.dragPointer = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events in tests have no active pointer to capture.
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.dragPointer) return;
    this.lookX += e.clientX - this.lastX;
    this.lookY += e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom += Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 60);
  };

  /** On-screen stick / buttons feed in here. */
  setTouchMove(x: number, z: number) {
    this.touchMove.x = x;
    this.touchMove.z = z;
    if (x !== 0 || z !== 0) this.gesture();
  }

  setTouchDive(active: boolean) {
    this.touchDive = active;
    if (active) this.gesture();
  }

  pressQuack() {
    this.gesture();
    this.quack = true;
  }

  /** Returns this frame's intents and clears the per-frame accumulators. */
  poll(): Intents {
    let x = this.touchMove.x;
    let z = this.touchMove.z;
    for (const code of this.down) {
      const m = MOVE_KEYS[code];
      if (m) {
        x += m[0];
        z += m[1];
      }
    }
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    const intents: Intents = {
      moveX: x,
      moveZ: z,
      dive: this.down.has('Space') || this.touchDive,
      lookX: this.lookX,
      lookY: this.lookY,
      zoom: this.zoom,
      dragging: this.dragPointer !== null,
      quack: this.quack,
      toggleMute: this.mute,
    };
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    this.quack = false;
    this.mute = false;
    return intents;
  }
}
