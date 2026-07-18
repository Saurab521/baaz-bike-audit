/**
 * ═══════════════════════════════════════════════
 *  UI Utilities
 *  Toast notifications, status messages,
 *  haptic feedback, audio cues
 * ═══════════════════════════════════════════════
 */

let toastContainer = null;

/** Initialize UI — call once after DOM ready */
export function initUI() {
  toastContainer = document.getElementById('toastContainer');
}

/** Shorthand for getElementById */
export function $(id) {
  return document.getElementById(id);
}

// ─────────────────────────────────────────
//  Toast Notifications
// ─────────────────────────────────────────

const TOAST_ICONS = { ok: '✓', err: '✗', info: 'ℹ', warn: '⚠' };

/**
 * Show a floating toast notification
 * @param {string} message  - Text to display
 * @param {'ok'|'err'|'info'|'warn'} type - Toast type
 * @param {number} duration - Auto-dismiss in ms
 */
export function showToast(message, type = 'ok', duration = 3500) {
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast__icon">${TOAST_ICONS[type] || ''}</span>
    <span class="toast__msg">${message}</span>
  `;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast--exit');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─────────────────────────────────────────
//  Status Messages (inline)
// ─────────────────────────────────────────

/**
 * Set an inline status message inside a container element
 * @param {HTMLElement} element - Container element
 * @param {string} message - Message HTML (empty to clear)
 * @param {'ok'|'err'} type
 */
export function setStatus(element, message, type) {
  if (!element) return;
  element.innerHTML = message
    ? `<div class="status-msg status-msg--${type}">${message}</div>`
    : '';
}

/**
 * Show a shimmer loading indicator inside a status container
 * @param {HTMLElement} element
 * @param {string} text - Loading text
 */
export function setLoading(element, text = 'Loading...') {
  if (!element) return;
  element.innerHTML = `
    <div class="status-msg status-msg--ok">
      <span class="shimmer" style="display:inline-block;width:140px;height:14px;margin-right:8px;vertical-align:middle;"></span>
      ${text}
    </div>
  `;
}

// ─────────────────────────────────────────
//  Haptic Feedback
// ─────────────────────────────────────────

/**
 * Trigger device vibration (mobile only)
 * @param {number|number[]} pattern - Vibration pattern in ms
 */
export function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// ─────────────────────────────────────────
//  Audio Cues
// ─────────────────────────────────────────

/**
 * Play a short beep sound
 * @param {number} frequency - Tone frequency in Hz
 * @param {number} duration  - Duration in ms
 */
export function playBeep(frequency = 880, duration = 120) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);
  } catch {
    /* AudioContext not supported */
  }
}

/** Feedback presets for common actions */
export const feedback = {
  scanSuccess() {
    vibrate([50, 30, 50]);
    playBeep(1200, 80);
  },
  auditOk() {
    vibrate([50, 50, 50]);
    playBeep(880, 100);
  },
  auditMismatch() {
    vibrate([100, 50, 100, 50, 100]);
    playBeep(300, 200);
  },
  error() {
    vibrate(200);
    playBeep(220, 200);
  },
  tap() {
    vibrate(30);
  },
};

// ─────────────────────────────────────────
//  DOM Helpers
// ─────────────────────────────────────────

/**
 * Re-trigger a CSS animation on an element
 * @param {HTMLElement} el
 * @param {string} animName - CSS animation name
 * @param {string} duration - CSS duration string
 */
export function replayAnimation(el, animName, duration = '0.35s') {
  el.style.animation = 'none';
  el.offsetHeight; // force reflow
  el.style.animation = `${animName} ${duration} ease-out`;
}

/**
 * Populate a <select> element with options
 * @param {HTMLSelectElement} selectEl
 * @param {Object<string, any>} items - { label: value, ... }
 * @param {string} placeholder - First disabled option text
 */
export function populateSelect(selectEl, items, placeholder = '— select —') {
  selectEl.innerHTML = `<option value="">${placeholder}</option>`;
  Object.entries(items).forEach(([label, value]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    selectEl.appendChild(opt);
  });
}
