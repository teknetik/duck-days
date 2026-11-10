import './styles.css';
import { Game } from './core/Game';

declare global {
  interface Window {
    /** Snapshot + play-test hooks (dev builds, or any build opened with ?debug). See README. */
    __DUCK_DAYS__?: Game;
  }
}

function boot() {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const loading = document.getElementById('loading')!;
  try {
    const game = new Game(canvas);
    // The diagnostics / play-test handle is only exposed in development or with ?debug.
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
      window.__DUCK_DAYS__ = game;
    }
    game.start();
  } catch (error) {
    console.error(error);
    loading.classList.add('error');
    loading.textContent =
      error instanceof Error
        ? `Duck Days could not start: ${error.message}`
        : 'Duck Days could not start on this device.';
  }
}

// Let the "Filling the pond" card paint before the (synchronous) world build.
// A timer rather than requestAnimationFrame, so a tab opened in the background still boots.
setTimeout(boot, 40);
