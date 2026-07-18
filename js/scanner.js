/**
 * ═══════════════════════════════════════════════
 *  Asset Scanner
 *  Wraps html5-qrcode for QR / barcode scanning
 * ═══════════════════════════════════════════════
 */

export class AssetScanner {
  #elementId;
  #onScan;
  #scanner;
  #running;
  #lastScan;
  #lastScanTime;
  #debounceMs;

  /**
   * @param {string} elementId  - DOM element ID for the scanner viewport
   * @param {function} onScan   - Callback with (decodedText) on successful scan
   * @param {number} debounceMs - Ignore same tag within this window
   */
  constructor(elementId, onScan, debounceMs = 3000) {
    this.#elementId = elementId;
    this.#onScan = onScan;
    this.#scanner = null;
    this.#running = false;
    this.#lastScan = '';
    this.#lastScanTime = 0;
    this.#debounceMs = debounceMs;
  }

  /** Is the camera currently scanning? */
  get isRunning() {
    return this.#running;
  }

  /**
   * Start the camera and begin scanning
   * @throws {Error} if camera access is denied or unavailable
   */
  async start() {
    if (this.#running) return;

    this.#scanner = new Html5Qrcode(this.#elementId, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ],
      verbose: false,
    });

    await this.#scanner.start(
      { facingMode: 'environment' },
      {
        fps: 12,
        qrbox: { width: 260, height: 180 },
        aspectRatio: 1.5,
      },
      (text) => this.#handleDecode(text),
      () => {} // ignore scan failures
    );

    this.#running = true;
  }

  /** Stop the camera */
  async stop() {
    if (!this.#running || !this.#scanner) return;
    try {
      await this.#scanner.stop();
    } catch {
      /* may already be stopped */
    }
    this.#running = false;
  }

  /**
   * Toggle camera on/off
   * @returns {boolean} new running state
   */
  async toggle() {
    if (this.#running) {
      await this.stop();
    } else {
      await this.start();
    }
    return this.#running;
  }

  /** Stop and restart the camera (useful for recovering from errors) */
  async reconnect() {
    await this.stop();
    await new Promise((r) => setTimeout(r, 400));
    await this.start();
  }

  /** Reset the last scan memory (allow same tag to be re-scanned) */
  clearLastScan() {
    this.#lastScan = '';
    this.#lastScanTime = 0;
  }

  /**
   * Internal: handle a decoded barcode/QR, with debounce
   */
  #handleDecode(text) {
    const now = Date.now();
    // Skip duplicate reads within debounce window
    if (text === this.#lastScan && now - this.#lastScanTime < this.#debounceMs) {
      return;
    }
    this.#lastScan = text;
    this.#lastScanTime = now;
    this.#onScan(text);
  }
}
