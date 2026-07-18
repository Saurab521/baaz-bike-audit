/**
 * ═══════════════════════════════════════════════
 *  Repair & Issues Manager
 *  Handles repair cost tracking and issue reporting
 *  with LocalStorage persistence per asset
 * ═══════════════════════════════════════════════
 */

// ─── Utility: Generate UUID ───
function uuid() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
    ((Math.random() * 16) | 0).toString(16)
  );
}

// ═════════════════════════════════════════════
//  Repair Categories & Issue Types
// ═════════════════════════════════════════════

export const REPAIR_CATEGORIES = {
  'IT Equipment (Laptop/Desktop)': [
    'Screen / Display Replace',
    'Keyboard / Mouse Replace',
    'Motherboard Repair',
    'RAM / Storage Upgrade',
    'CPU / Thermal Paste',
    'Power Supply (PSU) Replace',
    'Charger / Adapter Replace',
    'Battery Replace',
    'OS / Software Install',
    'Antivirus / Security',
    'Networking / Wi-Fi Card',
    'Casing / Hinge Repair',
    'Data Recovery',
    'Hardware Cleaning'
  ],
  'General': [
    'General Maintenance',
    'Other'
  ]
};

export const ISSUE_TYPES = {
  'IT Equipment (Laptop/Desktop)': [
    'Display / Monitor Issue',
    'Keyboard / Mouse Not Working',
    'Power / Battery Drain',
    'Heating / Fan Noise',
    'Slow Performance / Lag',
    'Software / OS Crash (BSOD)',
    'Network / Connectivity',
    'Storage / Hard Drive Failure',
    'Audio / Speaker Issue',
    'Peripheral / Port Issue'
  ],
  'General': [
    'Software / Display',
    'Other'
  ]
};

export const SEVERITY_LEVELS = [
  { value: 'critical', label: 'Critical', emoji: '🔴' },
  { value: 'medium',   label: 'Medium',   emoji: '🟡' },
  { value: 'low',      label: 'Low',      emoji: '🔵' },
];

// ═════════════════════════════════════════════
//  RepairManager
// ═════════════════════════════════════════════

const REPAIR_STORAGE_KEY = 'baaz_repairs';

export class RepairManager {
  #repairs;

  constructor() {
    this.#repairs = this.#load();
  }

  // ─── Persistence ───

  #load() {
    try {
      return JSON.parse(localStorage.getItem(REPAIR_STORAGE_KEY) || '[]');
    } catch { return []; }
  }

  #save() {
    try {
      localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(this.#repairs));
    } catch { /* quota */ }
  }

  // ─── CRUD ───

  /**
   * Add a new repair record
   * @param {object} data
   * @param {string} data.asset_tag
   * @param {string} data.asset_name
   * @param {string} data.date       - YYYY-MM-DD
   * @param {string} data.category
   * @param {number} data.amount     - Cost in ₹
   * @param {string} data.description
   * @param {string} data.parts      - Parts used (optional)
   * @returns {object} The created repair record
   */
  add({ asset_tag, asset_name, date, category, amount, description, parts = '' }) {
    const record = {
      id: uuid(),
      asset_tag,
      asset_name,
      date,
      category,
      amount: Number(amount) || 0,
      description,
      parts,
      created_at: Date.now(),
    };
    this.#repairs.unshift(record);
    this.#save();
    return record;
  }

  /**
   * Delete a repair record by ID
   */
  delete(id) {
    this.#repairs = this.#repairs.filter(r => r.id !== id);
    this.#save();
  }

  // ─── Queries ───

  /** Get all repairs, newest first */
  getAll() {
    return [...this.#repairs];
  }

  /** Get repairs for a specific asset */
  getByAssetTag(tag) {
    return this.#repairs.filter(r => r.asset_tag === tag);
  }

  /** Get total repair cost for an asset */
  getTotalCost(tag) {
    return this.getByAssetTag(tag).reduce((sum, r) => sum + r.amount, 0);
  }

  /** Get total repair cost across all assets */
  getGrandTotal() {
    return this.#repairs.reduce((sum, r) => sum + r.amount, 0);
  }

  /** Get total repair count */
  get totalCount() {
    return this.#repairs.length;
  }

  /** Get repair count for a specific asset */
  getCount(tag) {
    return this.getByAssetTag(tag).length;
  }

  /** Search repairs by asset tag, name, category, or description */
  search(query) {
    if (!query) return this.getAll();
    const q = query.toLowerCase();
    return this.#repairs.filter(r =>
      r.asset_tag.toLowerCase().includes(q) ||
      r.asset_name.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q)
    );
  }

  /** Get top N most expensive assets by total repair cost */
  getTopExpensiveAssets(n = 5) {
    const map = {};
    for (const r of this.#repairs) {
      if (!map[r.asset_tag]) {
        map[r.asset_tag] = { tag: r.asset_tag, name: r.asset_name, total: 0, count: 0 };
      }
      map[r.asset_tag].total += r.amount;
      map[r.asset_tag].count++;
    }
    return Object.values(map)
      .sort((a, b) => b.total - a.total)
      .slice(0, n);
  }

  /** Get category-wise cost breakdown */
  getCategoryBreakdown() {
    const map = {};
    for (const r of this.#repairs) {
      map[r.category] = (map[r.category] || 0) + r.amount;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }

  // ─── Export ───

  exportCSV() {
    const lines = ['Asset Tag,Asset Name,Date,Category,Amount (₹),Description,Parts'];
    for (const r of this.#repairs) {
      lines.push(
        `"${r.asset_tag}","${r.asset_name}","${r.date}","${r.category}","${r.amount}","${r.description}","${r.parts}"`
      );
    }
    lines.push('');
    lines.push(`"Total Repair Cost","₹${this.getGrandTotal().toLocaleString('en-IN')}"`);
    lines.push(`"Total Repairs","${this.totalCount}"`);
    return lines.join('\n');
  }

  exportJSON() {
    return JSON.stringify({
      summary: {
        totalCost: this.getGrandTotal(),
        totalRepairs: this.totalCount,
        topAssets: this.getTopExpensiveAssets(),
        categoryBreakdown: Object.fromEntries(this.getCategoryBreakdown()),
        exportDate: new Date().toISOString(),
      },
      repairs: this.#repairs,
    }, null, 2);
  }
}

// ═════════════════════════════════════════════
//  IssueManager
// ═════════════════════════════════════════════

const ISSUE_STORAGE_KEY = 'baaz_issues';

export class IssueManager {
  #issues;

  constructor() {
    this.#issues = this.#load();
  }

  // ─── Persistence ───

  #load() {
    try {
      return JSON.parse(localStorage.getItem(ISSUE_STORAGE_KEY) || '[]');
    } catch { return []; }
  }

  #save() {
    try {
      localStorage.setItem(ISSUE_STORAGE_KEY, JSON.stringify(this.#issues));
    } catch { /* quota */ }
  }

  // ─── CRUD ───

  /**
   * Add a new issue
   * @param {object} data
   * @param {string} data.asset_tag
   * @param {string} data.asset_name
   * @param {string} data.type       - Issue type
   * @param {string} data.severity   - critical / medium / low
   * @param {string} data.description
   * @returns {object} The created issue
   */
  add({ asset_tag, asset_name, type, severity, description }) {
    const issue = {
      id: uuid(),
      asset_tag,
      asset_name,
      type,
      severity,
      description,
      status: 'open',
      created_at: Date.now(),
      resolved_at: null,
    };
    this.#issues.unshift(issue);
    this.#save();
    return issue;
  }

  /** Mark an issue as resolved */
  resolve(id) {
    const issue = this.#issues.find(i => i.id === id);
    if (issue) {
      issue.status = 'resolved';
      issue.resolved_at = Date.now();
      this.#save();
    }
  }

  /** Reopen a resolved issue */
  reopen(id) {
    const issue = this.#issues.find(i => i.id === id);
    if (issue) {
      issue.status = 'open';
      issue.resolved_at = null;
      this.#save();
    }
  }

  /** Delete an issue */
  delete(id) {
    this.#issues = this.#issues.filter(i => i.id !== id);
    this.#save();
  }

  // ─── Queries ───

  getAll() { return [...this.#issues]; }

  getByAssetTag(tag) {
    return this.#issues.filter(i => i.asset_tag === tag);
  }

  getOpenByAssetTag(tag) {
    return this.#issues.filter(i => i.asset_tag === tag && i.status === 'open');
  }

  getOpenCount(tag) {
    return tag
      ? this.getOpenByAssetTag(tag).length
      : this.#issues.filter(i => i.status === 'open').length;
  }

  getResolvedCount() {
    return this.#issues.filter(i => i.status === 'resolved').length;
  }

  get totalCount() { return this.#issues.length; }

  /** Search issues */
  search(query) {
    if (!query) return this.getAll();
    const q = query.toLowerCase();
    return this.#issues.filter(i =>
      i.asset_tag.toLowerCase().includes(q) ||
      i.asset_name.toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.severity.toLowerCase().includes(q)
    );
  }

  // ─── Export ───

  exportCSV() {
    const lines = ['Asset Tag,Asset Name,Type,Severity,Description,Status,Created,Resolved'];
    for (const i of this.#issues) {
      const created = new Date(i.created_at).toLocaleString();
      const resolved = i.resolved_at ? new Date(i.resolved_at).toLocaleString() : '';
      lines.push(
        `"${i.asset_tag}","${i.asset_name}","${i.type}","${i.severity}","${i.description}","${i.status}","${created}","${resolved}"`
      );
    }
    lines.push('');
    lines.push(`"Total Issues","${this.totalCount}"`);
    lines.push(`"Open","${this.getOpenCount()}"`);
    lines.push(`"Resolved","${this.getResolvedCount()}"`);
    return lines.join('\n');
  }
}

// ═════════════════════════════════════════════
//  Download Helper
// ═════════════════════════════════════════════

export function downloadFile(content, filename, mimeType = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
