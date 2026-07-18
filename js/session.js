/**
 * ═══════════════════════════════════════════════
 *  Session Manager
 *  Handles audit session lifecycle:
 *  timer, log entries, stats, export, storage
 * ═══════════════════════════════════════════════
 */

export class SessionManager {
  #log;
  #counts;
  #startTime;
  #timerInterval;
  #timerCallback;
  #locationBreakdown;

  constructor() {
    this.#log = [];
    this.#counts = { scanned: 0, verified: 0, mismatch: 0 };
    this.#startTime = null;
    this.#timerInterval = null;
    this.#timerCallback = null;
    this.#locationBreakdown = {};
  }

  // ─── Getters ───

  get log() { return [...this.#log]; }
  get counts() { return { ...this.#counts }; }
  get startTime() { return this.#startTime; }
  get locationBreakdown() { return { ...this.#locationBreakdown }; }
  get isEmpty() { return this.#log.length === 0; }
  get logCount() { return this.#log.length; }

  /** Elapsed seconds since session start */
  get elapsed() {
    if (!this.#startTime) return 0;
    return Math.floor((Date.now() - this.#startTime) / 1000);
  }

  /** Formatted elapsed time MM:SS */
  get elapsedFormatted() {
    const s = this.elapsed;
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }

  /** Success rate percentage */
  get successRate() {
    const total = this.#counts.verified + this.#counts.mismatch;
    if (total === 0) return 0;
    return Math.round((this.#counts.verified / total) * 100);
  }

  // ─── Timer ───

  /**
   * Start the session timer
   * @param {function} callback - Called every second with formatted time
   */
  startTimer(callback) {
    this.#startTime = Date.now();
    this.#timerCallback = callback;
    this.#timerInterval = setInterval(() => {
      if (this.#timerCallback) {
        this.#timerCallback(this.elapsedFormatted);
      }
    }, 1000);
  }

  /** Stop the session timer */
  stopTimer() {
    clearInterval(this.#timerInterval);
    this.#timerInterval = null;
  }

  // ─── State Persistence ───
  saveState() {
    Storage.saveActiveSession({
      log: this.#log,
      counts: this.#counts,
      startTime: this.#startTime,
      locationBreakdown: this.#locationBreakdown
    });
  }

  restoreState(state) {
    if (!state) return;
    this.#log = state.log || [];
    this.#counts = state.counts || { scanned: 0, verified: 0, mismatch: 0 };
    this.#startTime = state.startTime || null;
    this.#locationBreakdown = state.locationBreakdown || {};
  }

  // ─── Log Entries ───

  /** Increment scanned count (called when asset is looked up) */
  addScan() {
    this.#counts.scanned++;
    this.saveState();
  }

  /**
   * Add an audit entry to the session log
   */
  addEntry({ tag, name, type, label, location = '', note = '' }) {
    if (type === 'ok') this.#counts.verified++;
    if (type === 'bad') this.#counts.mismatch++;

    if (location) {
      this.#locationBreakdown[location] =
        (this.#locationBreakdown[location] || 0) + 1;
    }

    this.#log.unshift({
      tag,
      name,
      type,
      label,
      location,
      note,
      time: new Date().toLocaleTimeString(),
      timestamp: Date.now(),
    });
    this.saveState();
  }

  /**
   * Search/filter session log
   * @param {string} query - Search text
   * @returns {object[]} Filtered log entries
   */
  search(query) {
    if (!query) return [...this.#log];
    const q = query.toLowerCase();
    return this.#log.filter(
      (e) =>
        e.tag.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.label.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q)
    );
  }

  // ─── Export ───

  /** Generate CSV string of the session log */
  exportCSV() {
    const lines = ['Asset Tag,Asset Name,Location,Status,Note,Time'];

    for (const e of this.#log) {
      lines.push(
        `"${e.tag}","${e.name}","${e.location}","${e.label}","${e.note}","${e.time}"`
      );
    }

    lines.push('');
    lines.push('"--- Session Summary ---"');
    lines.push(`"Total Scanned","${this.#counts.scanned}"`);
    lines.push(`"Verified","${this.#counts.verified}"`);
    lines.push(`"Mismatches","${this.#counts.mismatch}"`);
    lines.push(`"Success Rate","${this.successRate}%"`);
    lines.push(`"Duration","${this.elapsedFormatted}"`);
    lines.push(`"Exported","${new Date().toLocaleString()}"`);

    // Location breakdown
    const locEntries = Object.entries(this.#locationBreakdown);
    if (locEntries.length > 0) {
      lines.push('');
      lines.push('"--- Location Breakdown ---"');
      lines.push('"Location","Count"');
      locEntries
        .sort((a, b) => b[1] - a[1])
        .forEach(([loc, count]) => {
          lines.push(`"${loc}","${count}"`);
        });
    }

    return lines.join('\n');
  }

  /** Trigger CSV download in the browser */
  downloadCSV() {
    const csv = this.exportCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baaz_audit_${new Date().toISOString().slice(0, 10)}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Generate a JSON export of the session */
  exportJSON() {
    return JSON.stringify(
      {
        session: {
          date: new Date().toISOString(),
          duration: this.elapsedFormatted,
          counts: this.#counts,
          successRate: this.successRate,
          locationBreakdown: this.#locationBreakdown,
        },
        entries: this.#log,
      },
      null,
      2
    );
  }

  /** Trigger JSON download */
  downloadJSON() {
    const json = this.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baaz_audit_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ─── Reset ───

  /** Reset the entire session */
  reset() {
    this.stopTimer();
    this.#log = [];
    this.#counts = { scanned: 0, verified: 0, mismatch: 0 };
    this.#locationBreakdown = {};
    this.#startTime = null;
    Storage.clearActiveSession();
  }
}

// ═════════════════════════════════════════════
//  LocalStorage Helper
// ═════════════════════════════════════════════

export const Storage = {
  KEYS: {
    URL: 'baaz_snipeit_url',
    TOKEN: 'baaz_snipeit_token',
    HISTORY: 'baaz_audit_history',
    ACTIVE_SESSION: 'baaz_active_session',
  },

  /** Save Snipe-IT URL */
  saveUrl(url) {
    try { localStorage.setItem(this.KEYS.URL, url); } catch { /* quota */ }
  },

  /** Get saved Snipe-IT URL */
  getUrl() {
    try { return localStorage.getItem(this.KEYS.URL) || ''; } catch { return ''; }
  },

  /** Save API Token */
  saveToken(token) {
    try { localStorage.setItem(this.KEYS.TOKEN, token); } catch { /* quota */ }
  },

  /** Get saved API Token */
  getToken() {
    try { return localStorage.getItem(this.KEYS.TOKEN) || ''; } catch { return ''; }
  },

  /** Save current active session state */
  saveActiveSession(sessionObj) {
    try {
      localStorage.setItem(this.KEYS.ACTIVE_SESSION, JSON.stringify(sessionObj));
    } catch { /* quota */ }
  },

  /** Get active session state */
  getActiveSession() {
    try {
      const data = localStorage.getItem(this.KEYS.ACTIVE_SESSION);
      return data ? JSON.parse(data) : null;
    } catch { return null; }
  },

  /** Clear active session state */
  clearActiveSession() {
    try { localStorage.removeItem(this.KEYS.ACTIVE_SESSION); } catch {}
  },

  /** Save a session summary to history */
  saveSession(session) {
    try {
      const history = this.getHistory();
      history.unshift({
        date: new Date().toISOString(),
        counts: session.counts,
        elapsed: session.elapsedFormatted,
        successRate: session.successRate,
        logCount: session.logCount,
      });
      // Keep last 50 sessions
      localStorage.setItem(
        this.KEYS.HISTORY,
        JSON.stringify(history.slice(0, 50))
      );
    } catch { /* quota exceeded */ }
  },

  /** Get past session summaries */
  getHistory() {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.HISTORY) || '[]');
    } catch {
      return [];
    }
  },
};
