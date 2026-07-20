/**
 * ═══════════════════════════════════════════════
 *  BAAZ ASSET AUDIT SCANNER — Main Application
 *  Ties together API, Scanner, Session, and UI
 * ═══════════════════════════════════════════════
 */

import { SnipeAPI } from './api.js?v=13';
import { AssetScanner } from './scanner.js?v=13';
import { SessionManager, Storage } from './session.js?v=13';
import {
  initUI, $, showToast, setStatus, setLoading,
  feedback, replayAnimation, populateSelect,
} from './ui.js?v=13';
import {
  RepairManager, IssueManager, downloadFile,
  REPAIR_CATEGORIES, ISSUE_TYPES, SEVERITY_LEVELS,
} from './repair.js?v=13';

class App {
  constructor() {
    this.api = null;
    this.scanner = null;
    this.session = new SessionManager();
    this.repairs = new RepairManager();
    this.issues = new IssueManager();
    this.currentAsset = null;
    this.locations = {};       // name → id
    this.activeView = 'viewSetup';
    this.locationAssets = [];  // To store assets for the selected location
    this.ocrScanning = false;  // OCR scan in progress flag
  }

  // ─────────────────────────────────────────
  //  Initialization
  // ─────────────────────────────────────────

  init() {
    initUI();
    this.loadSavedSettings();
    this.bindEvents();
    
    // Auto-connect if URL and token are saved
    const url = $('inputUrl').value.trim();
    const token = $('inputToken').value.trim();
    if (url && token) {
      this.connect(true);
    }
  }

  loadSavedSettings() {
    const url = Storage.getUrl();
    const token = Storage.getToken();
    if (url) $('inputUrl').value = url;
    if (token) $('inputToken').value = token;
  }

  bindEvents() {
    // ── Setup ──
    $('btnConnect').addEventListener('click', () => this.connect());
    $('inputToken').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.connect();
    });

    // ── Scanner ──
    $('btnToggleCamera').addEventListener('click', () => this.toggleCamera());
    $('btnReconnect').addEventListener('click', () => this.reconnectCamera());
    $('btnManualLookup').addEventListener('click', () => this.manualLookup());
    $('inputManualTag').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.manualLookup();
    });

    // ── Serial Number Search ──
    $('btnSerialLookup').addEventListener('click', () => this.serialLookup());
    $('inputSerialNumber').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.serialLookup();
    });

    // ── OCR Serial Scan ──
    $('btnOcrScan').addEventListener('click', () => this.ocrScanSerial());

    // ── Audit actions ──
    $('btnConfirm').addEventListener('click', () => this.doAudit(false));
    $('btnMismatch').addEventListener('click', () => {
      $('mismatchForm').classList.toggle('hidden');
      feedback.tap();
    });
    $('btnSubmitMismatch').addEventListener('click', () => this.doAudit(true));

    // ── Bottom navigation ──
    document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.switchView(btn.dataset.view);
        feedback.tap();
      });
    });

    // ── Assets View ──
    $('selectAssetLocation')?.addEventListener('change', (e) => {
      this.fetchAssetsForLocation(e.target.value);
    });

    document.querySelectorAll('#assetsSegmentControl .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#assetsSegmentControl .segment-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const tab = btn.dataset.tab;
        $('listPending').classList.toggle('hidden', tab !== 'pending');
        $('listAudited').classList.toggle('hidden', tab !== 'audited');
        feedback.tap();
      });
    });

    // ── Log search ──
    $('inputLogSearch').addEventListener('input', (e) => {
      this.renderLog(e.target.value.trim());
    });

    // ── Repair & Issue: Quick Actions from Asset Card ──
    $('btnQuickRepair').addEventListener('click', () => this.openRepairModal(true));
    $('btnQuickIssue').addEventListener('click', () => this.openIssueModal(true));

    // ── Repair & Issue: View Buttons ──
    $('btnAddRepair').addEventListener('click', () => this.openRepairModal(false));
    $('btnAddIssue').addEventListener('click', () => this.openIssueModal(false));

    // ── Repair Modal ──
    $('btnCloseRepairModal').addEventListener('click', () => this.closeRepairModal());
    $('btnSubmitRepair').addEventListener('click', () => this.submitRepair());
    $('modalRepair').addEventListener('click', (e) => {
      if (e.target === $('modalRepair')) this.closeRepairModal();
    });

    // ── Issue Modal ──
    $('btnCloseIssueModal').addEventListener('click', () => this.closeIssueModal());
    $('btnSubmitIssue').addEventListener('click', () => this.submitIssue());
    $('modalIssue').addEventListener('click', (e) => {
      if (e.target === $('modalIssue')) this.closeIssueModal();
    });

    // ── Repair/Issue Segment Control ──
    document.querySelectorAll('#repairSegmentControl .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#repairSegmentControl .segment-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const tab = btn.dataset.reptab;
        $('repairHistoryList').classList.toggle('hidden', tab !== 'repairs');
        $('issuesList').classList.toggle('hidden', tab !== 'issues');
        $('topAssetsList').classList.toggle('hidden', tab !== 'top-assets');
        feedback.tap();
      });
    });

    // ── Repair/Issue Search ──
    $('inputRepairSearch').addEventListener('input', (e) => {
      this.renderRepairsView(e.target.value.trim());
    });

    // ── Repair/Issue Export ──
    $('btnExportRepairCsv').addEventListener('click', () => this.exportRepairCSV());
    $('btnExportIssuesCsv').addEventListener('click', () => this.exportIssuesCSV());

    // ── Snipe-IT Advanced Integrations ──
    $('btnOfficialAudit').addEventListener('click', () => this.submitOfficialAudit());
    $('btnCheckoutModal').addEventListener('click', () => this.openCheckoutModal());
    $('btnCheckin').addEventListener('click', () => this.submitCheckin());
    $('btnStatusModal').addEventListener('click', () => this.openStatusModal());

    $('btnCloseCheckoutModal').addEventListener('click', () => this.closeCheckoutModal());
    $('btnSubmitCheckout').addEventListener('click', () => this.submitCheckout());

    $('btnCloseStatusModal').addEventListener('click', () => this.closeStatusModal());
    $('btnSubmitStatus').addEventListener('click', () => this.submitStatus());

    // ── Actions ──
    $('btnExportCsv').addEventListener('click', () => this.exportCSV());
    $('btnExportJson').addEventListener('click', () => this.exportJSON());
    $('btnPrint').addEventListener('click', () => window.print());
    $('btnNewSession').addEventListener('click', () => this.resetSession());
    $('btnDisconnect').addEventListener('click', () => this.disconnect());

    // ── Keyboard shortcuts ──
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        this.exportCSV();
      }
      if (e.key === 'Escape') {
        $('mismatchForm')?.classList.add('hidden');
        this.closeRepairModal();
        this.closeIssueModal();
        this.closeCheckoutModal();
        this.closeStatusModal();
      }
    });

    // ── Populate Repair/Issue dropdowns ──
    this.populateRepairDropdowns();
  }

  // ─────────────────────────────────────────
  //  Connection
  // ─────────────────────────────────────────

  async connect(isAuto = false) {
    const url = $('inputUrl').value.trim().replace(/\/+$/, '');
    const token = $('inputToken').value.trim();

    if (!url || !token) {
      setStatus($('setupStatus'), 'Please enter both URL and Token', 'err');
      feedback.error();
      return;
    }

    // Save URL and Token for persistence
    Storage.saveUrl(url);
    Storage.saveToken(token);

    // Disable button
    const btn = $('btnConnect');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Connecting...';

    try {
      this.api = new SnipeAPI(url, token);
      const result = await this.api.testConnection();

      // Load locations for mismatch dropdown
      await this.loadLocations();

      // Restore session if exists
      const savedSession = Storage.getActiveSession();
      if (savedSession) {
        this.session.restoreState(savedSession);
        this.updateStats();
      }

      // Update connection indicator
      $('connBadge').classList.add('is-live');
      $('connLabel').textContent = 'Connected';
      setStatus($('setupStatus'), `Connected ✓ — ${result.total} assets found`, 'ok');
      feedback.auditOk();

        // Transition to scanner
      setTimeout(async () => {
        this.switchView('viewScan');
        $('bottomNav').classList.remove('hidden');
        this.startScanner();
        
        // Restore timer or start it if not started
        if (this.session.startTime) {
           this.session.startTimer((time) => {
             $('timerDisplay').textContent = time;
           });
        } else {
           this.session.startTimer((time) => {
             $('timerDisplay').textContent = time;
           });
        }
        
        $('sessionTimer').classList.remove('hidden');
        showToast(isAuto ? 'Session restored!' : 'Connected to Snipe-IT! Scanner ready.', 'ok');
        
        // --- DEBUG MAINTENANCE TYPES ENDPOINT ---
        const endpoints = ['/maintenances/types', '/maintenancetypes', '/assetmaintenancetypes', '/asset-maintenance-types', '/asset_maintenance_types', '/maintenance-types'];
        for (const ep of endpoints) {
          try {
            const res = await this.api.testEndpoint(ep);
            if (res && res.rows) {
              alert('BINGO! Maintenance types endpoint is: ' + ep);
              break;
            }
          } catch (e) {
            console.log('Not ' + ep);
          }
        }
        // ----------------------------------------
        
      }, 500);

    } catch (err) {
      setStatus(
        $('setupStatus'),
        `Connection failed: ${err.message}`,
        'err'
      );
      feedback.error();
      this.api = null;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        Connect &amp; Start
      `;
    }
  }

  async loadLocations() {
    try {
      const data = await this.api.getLocations();
      this.locations = {};
      (data.rows || []).forEach((r) => {
        this.locations[r.name] = r.id;
      });
      populateSelect($('selectLocation'), this.locations, '— Select Location —');
      populateSelect($('selectAssetLocation'), this.locations, '— Select Location —');
    } catch {
      /* non-fatal — mismatch dropdown just won't have locations */
    }
  }

  disconnect() {
    this.stopScanner();
    
    // Clear token on explicit disconnect, but KEEP session data
    Storage.saveToken('');
    $('inputToken').value = '';

    this.api = null;
    this.currentAsset = null;

    // Reset UI
    this.updateStats();
    $('bottomNav').classList.add('hidden');
    $('connBadge').classList.remove('is-live');
    $('connLabel').textContent = 'Logged Out';
    $('sessionTimer').classList.add('hidden');
    $('assetCard').classList.add('hidden');
    $('inputToken').value = '';
    setStatus($('setupStatus'), '', '');
    this.switchView('viewSetup');
    showToast('Logged out from Snipe-IT', 'info');
  }

  // ─────────────────────────────────────────
  //  View Navigation
  // ─────────────────────────────────────────

  switchView(viewId) {
    // Hide all views
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));

    // Show target view
    const target = $(viewId);
    if (target) {
      target.classList.remove('hidden');
      replayAnimation(target, 'fadeUp', '0.35s');
    }

    // Update nav buttons
    document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.view === viewId);
    });

    this.activeView = viewId;

    // Refresh view-specific data
    if (viewId === 'viewLog') this.renderLog();
    if (viewId === 'viewReports') this.renderDashboard();
    if (viewId === 'viewAssets' && this.locationAssets.length > 0) this.renderAssetsList();
    if (viewId === 'viewRepairs') this.renderRepairsView();
  }

  // ─────────────────────────────────────────
  //  Scanner
  // ─────────────────────────────────────────

  async startScanner() {
    try {
      this.scanner = new AssetScanner('reader', (text) => this.onScan(text));
      await this.scanner.start();
      $('btnToggleCamera').innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        Stop camera
      `;
      $('scanLine').classList.remove('hidden');
    } catch (err) {
      setStatus(
        $('scanStatus'),
        `Failed to start camera — please use manual entry. (${err.message || err})`,
        'err'
      );
      $('scanLine').classList.add('hidden');
    }
  }

  async stopScanner() {
    if (this.scanner) {
      await this.scanner.stop();
      $('scanLine').classList.add('hidden');
    }
  }

  async toggleCamera() {
    if (!this.scanner) return;
    const running = await this.scanner.toggle();
    $('btnToggleCamera').innerHTML = running
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop camera`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start camera`;
    $('scanLine').classList.toggle('hidden', !running);
    feedback.tap();
  }

  async reconnectCamera() {
    if (!this.scanner) return;
    showToast('Camera reconnecting...', 'info', 1500);
    try {
      await this.scanner.reconnect();
      $('scanLine').classList.remove('hidden');
      $('btnToggleCamera').innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        Stop camera
      `;
    } catch (err) {
      setStatus($('scanStatus'), `Reconnect failed: ${err}`, 'err');
    }
  }

  // ─────────────────────────────────────────
  //  Asset Lookup
  // ─────────────────────────────────────────

  #parseScannedText(text) {
    text = text.trim();
    // If it's a URL, extract the last segment
    if (text.startsWith('http://') || text.startsWith('https://')) {
      // e.g. https://baazbikes.snipe-it.io/hardware/1
      //      https://domain.com/hardware/BZLAP001
      const parts = text.split('/');
      let last = parts.pop();
      if (!last && parts.length > 0) {
        last = parts.pop(); // handle trailing slash
      }
      // Return object with extracted value + flag if it looks like a Snipe-IT hardware URL ID
      const extracted = (last || '').trim();
      const isSnipeUrl = text.includes('/hardware/');
      return { tag: extracted, isSnipeUrl };
    }

    // Check for Snipe-IT multiline label format
    const match = text.match(/(?:^|\n)\s*T\s*:?\s*([A-Za-z0-9_-]+)/i);
    if (match && match[1]) {
      return { tag: match[1].trim(), isSnipeUrl: false };
    }
    // Try catching a tag anywhere if it starts with BZ
    const bzMatch = text.match(/\b(BZ[A-Za-z0-9_-]+)/i);
    if (bzMatch && bzMatch[1]) {
      return { tag: bzMatch[1].trim(), isSnipeUrl: false };
    }

    // Fallback: assume the whole string is the tag
    return { tag: text.trim(), isSnipeUrl: false };
  }

  onScan(text) {
    feedback.scanSuccess();
    const parsed = this.#parseScannedText(text);
    if (!parsed || !parsed.tag) return;
    this.lookupAsset(parsed.tag, text, parsed.isSnipeUrl);
  }

  manualLookup() {
    let input = $('inputManualTag').value.trim();
    if (!input) return;
    $('inputManualTag').value = '';
    
    const parsed = this.#parseScannedText(input);
    this.lookupAsset(parsed.tag, '', parsed.isSnipeUrl);
  }

  async serialLookup() {
    const serial = $('inputSerialNumber').value.trim();
    if (!serial) return;
    if (!this.api) {
      showToast('Please connect to Snipe-IT first!', 'err');
      return;
    }

    $('inputSerialNumber').value = '';
    setLoading($('scanStatus'), `Searching serial [${serial}]...`);

    try {
      const result = await this.api.getAssetBySerial(serial);

      // byserial returns { rows: [...] } format
      let asset = null;
      if (result && result.rows && result.rows.length > 0) {
        asset = result.rows[0]; // Pick the first matching asset
        if (result.rows.length > 1) {
          showToast(`${result.rows.length} assets found with this serial — showing first one`, 'info', 4000);
        }
      } else if (result && result.id) {
        // Direct asset object returned
        asset = result;
      }

      if (!asset) {
        throw new Error(`No asset found with serial number: ${serial}`);
      }

      this.showAsset(asset);
      setStatus($('scanStatus'), '', '');
    } catch (err) {
      setStatus($('scanStatus'), `Serial [${serial}]: ${err.message}`, 'err');
      feedback.error();
      showToast(`Serial search failed: ${err.message}`, 'err', 5000);
    }
  }

  // ─────────────────────────────────────────
  //  OCR Serial Number Scan
  // ─────────────────────────────────────────

  async ocrScanSerial() {
    if (this.ocrScanning) {
      showToast('OCR scan already in progress...', 'info');
      return;
    }

    if (!this.api) {
      showToast('Please connect to Snipe-IT first!', 'err');
      return;
    }

    // Check if Tesseract is loaded
    if (typeof Tesseract === 'undefined') {
      showToast('OCR library not loaded. Please check internet connection.', 'err');
      return;
    }

    // Find the video element from the QR scanner
    const videoEl = document.querySelector('#reader video');
    if (!videoEl || videoEl.paused || videoEl.ended || !videoEl.srcObject) {
      showToast('Camera chal nahi rahi! Pehle camera start karo, phir scan karo.', 'err');
      return;
    }

    this.ocrScanning = true;
    const ocrBtn = $('btnOcrScan');
    const ocrStatus = $('ocrStatus');
    const ocrPreview = $('ocrPreview');
    const ocrCanvas = $('ocrCanvas');
    const ocrOverlay = $('ocrOverlayText');

    ocrBtn.disabled = true;
    ocrBtn.innerHTML = '<span class="spin"></span> 📷 Scanning... Camera steady rakho!';
    ocrStatus.textContent = '';
    ocrStatus.className = '';

    try {
      // Step 1: Capture frame from video onto canvas
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      ocrCanvas.width = vw;
      ocrCanvas.height = vh;
      const ctx = ocrCanvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, vw, vh);

      // Show preview
      ocrPreview.classList.remove('hidden');
      ocrOverlay.textContent = '🔍 Processing image...';

      // Step 2: Enhance image for better OCR — increase contrast, greyscale
      const imgData = ctx.getImageData(0, 0, vw, vh);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        // Convert to greyscale
        const avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        // Apply threshold for sharper text contrast
        const val = avg > 128 ? 255 : 0;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
      ctx.putImageData(imgData, 0, 0);

      // Step 3: Run Tesseract OCR
      ocrOverlay.textContent = '🧠 OCR processing... thoda wait karo...';

      const result = await Tesseract.recognize(ocrCanvas, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && m.progress) {
            const pct = Math.round(m.progress * 100);
            ocrOverlay.textContent = `🧠 Reading text... ${pct}%`;
          }
        }
      });

      const rawText = (result.data.text || '').trim();
      console.log('[OCR] Raw text:', rawText);

      if (!rawText) {
        ocrOverlay.textContent = '❌ Kuch nahi mila. Serial number camera ke saamne rakho aur phir try karo.';
        ocrStatus.textContent = 'No text detected. Try again with better lighting.';
        ocrStatus.style.color = '#f87171';
        feedback.error();
        return;
      }

      // Step 4: Extract potential serial numbers
      // Serial numbers are typically alphanumeric, 4+ characters, might have dashes
      const candidates = rawText
        .split(/[\n\r\s,;|]+/)
        .map(s => s.replace(/[^A-Za-z0-9\-_]/g, '').trim())
        .filter(s => s.length >= 4)
        .filter(s => /[A-Za-z]/.test(s) || /\d{4,}/.test(s)); // Must have letters or be 4+ digit number

      // Show all detected text
      ocrOverlay.innerHTML = `
        <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">📝 Detected text:</div>
        <div style="color:#e2e8f0; margin-bottom:6px;">${rawText.replace(/\n/g, ' | ')}</div>
        ${candidates.length > 0 
          ? `<div style="font-size:11px; color:#a78bfa;">🎯 Possible serials: ${candidates.join(', ')}</div>` 
          : '<div style="color:#f87171;">No serial pattern found</div>'
        }
      `;

      if (candidates.length > 0) {
        // Pick the best candidate — prefer longer alphanumeric strings
        const bestCandidate = candidates.sort((a, b) => b.length - a.length)[0];

        // Auto-fill the serial input
        $('inputSerialNumber').value = bestCandidate;

        ocrStatus.innerHTML = `✅ Serial detected: <b>${bestCandidate}</b> — Search button dabao ya Enter karo!`;
        ocrStatus.style.color = '#4ade80';
        feedback.auditOk();
        showToast(`Serial detected: ${bestCandidate}`, 'ok', 3000);

        // Focus on serial input so user can press Enter
        $('inputSerialNumber').focus();
      } else {
        ocrStatus.textContent = 'Text mila lekin serial number pattern nahi mila. Manually type karo.';
        ocrStatus.style.color = '#fbbf24';
        feedback.error();
      }

    } catch (err) {
      console.error('[OCR] Error:', err);
      ocrOverlay.textContent = `❌ OCR Error: ${err.message}`;
      ocrStatus.textContent = `OCR failed: ${err.message}`;
      ocrStatus.style.color = '#f87171';
      feedback.error();
      showToast(`OCR scan failed: ${err.message}`, 'err');
    } finally {
      this.ocrScanning = false;
      ocrBtn.disabled = false;
      ocrBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M3 9h2M19 9h2M3 15h2M19 15h2"/>
        </svg>
        📷 Camera se Serial Scan karo (OCR)
      `;
    }
  }

  async lookupAsset(tag, rawText = '', isSnipeUrl = false) {
    if (!this.api) return;

    setLoading($('scanStatus'), `Looking up [${tag}]...`);

    try {
      let asset;

      if (isSnipeUrl && /^\d+$/.test(tag)) {
        // QR code is a Snipe-IT URL like /hardware/1 — the number is the DB ID
        // Strategy: Try ID first, then search all hardware to find matching ID
        try {
          asset = await this.api.getAssetById(tag);
        } catch (idErr) {
          // ID direct lookup failed — search all hardware to find this ID
          try {
            const searchRes = await this.api.searchAssets(tag, 50);
            if (searchRes && searchRes.rows) {
              asset = searchRes.rows.find(a => String(a.id) === String(tag));
            }
          } catch (searchErr) {
            // search also failed
          }

          if (!asset) {
            // Last resort: list hardware and find by ID
            try {
              const listRes = await this.api.listAssets({ limit: 500 });
              if (listRes && listRes.rows) {
                asset = listRes.rows.find(a => String(a.id) === String(tag));
              }
            } catch (listErr) {
              // list also failed
            }
          }

          if (!asset) {
            throw new Error(`Asset with ID ${tag} not found. The QR code points to Snipe-IT hardware ID ${tag} but the API cannot find it. Try entering the Asset Tag (e.g. BZLAP005) manually.`);
          }
        }
      } else {
        // Normal flow: try by asset tag first
        try {
          asset = await this.api.getAssetByTag(tag);
        } catch (tagErr) {
          if (tagErr.status === 404 && /^\d+$/.test(tag)) {
            // Might be a DB ID
            try {
              asset = await this.api.getAssetById(tag);
            } catch (idErr) {
              throw tagErr; // throw original tag error
            }
          } else {
            throw tagErr;
          }
        }
      }

      this.showAsset(asset);
      setStatus($('scanStatus'), '', '');
    } catch (err) {
      setStatus($('scanStatus'), `Tag [${tag}]: ${err.message}`, 'err');
      feedback.error();
      const debugText = rawText ? `(Extracted: ${tag} | Raw QR: ${rawText})` : `(Searched for: ${tag})`;
      showToast(`${err.message} ${debugText}`, 'err', 6000);
    }
  }

  showAsset(asset) {
    this.currentAsset = asset;
    this.session.addScan();
    this.updateStats();

    // Populate card
    $('tagNumber').textContent = asset.asset_tag || '—';
    $('tagName').textContent =
      asset.name || (asset.model && asset.model.name) || '—';
    $('tagAssetTag').textContent = asset.asset_tag || '—';
    $('tagModel').textContent =
      (asset.model && asset.model.name) || '—';
    $('tagSerial').textContent = asset.serial || '—';
    $('tagLocation').textContent =
      (asset.location && asset.location.name) || 'Unassigned';
    $('tagAssigned').textContent =
      (asset.assigned_to && asset.assigned_to.name) || '—';
    $('tagStatusLabel').textContent =
      (asset.status_label && asset.status_label.name) || '—';
    $('tagCategory').textContent =
      (asset.category && asset.category.name) || '—';
    $('tagLastAudit').textContent =
      (asset.last_audit_date && asset.last_audit_date.formatted) 
      || (typeof asset.last_audit_date === 'string' ? asset.last_audit_date : 'Never audited');

    // Repair & Issue quick stats
    const repairCost = this.repairs.getTotalCost(asset.asset_tag);
    const repairCount = this.repairs.getCount(asset.asset_tag);
    const openIssues = this.issues.getOpenCount(asset.asset_tag);
    $('tagRepairCost').textContent = '₹' + repairCost.toLocaleString('en-IN');
    $('tagRepairCount').textContent = repairCount;
    $('tagIssueCount').textContent = openIssues;

    // Reset card state
    $('stamp').classList.add('hidden');
    $('mismatchForm').classList.add('hidden');
    $('inputRemarks').value = '';
    setStatus($('actionStatus'), '', '');

    // Show card with animation
    $('assetCard').classList.remove('hidden');
    replayAnimation($('assetCard'), 'slideIn');

    showToast(`Asset found: ${asset.asset_tag}`, 'ok', 2000);
  }

  // ─────────────────────────────────────────
  //  Audit Actions
  // ─────────────────────────────────────────

  async doAudit(isMismatch) {
    if (!this.currentAsset || !this.api) return;

    const asset = this.currentAsset;
    let note, locationId = null;

    if (isMismatch) {
      const locName = $('selectLocation').value;
      const remarks = $('inputRemarks').value.trim();
      note = 'MISMATCH: ' + (remarks || 'no remarks');
      if (locName) {
        locationId = this.locations[locName] || null;
      }
    } else {
      note = 'Physical audit confirmed — asset verified at assigned location.';
    }

    setLoading($('actionStatus'), 'Submitting audit...');

    try {
      await this.api.auditAsset(asset.id, { note, locationId });

      // Update stamp
      const stamp = $('stamp');
      if (isMismatch) {
        stamp.textContent = 'MISMATCH';
        stamp.className = 'stamp stamp--mismatch';
        feedback.auditMismatch();
        showToast(`Mismatch reported: ${asset.asset_tag}`, 'err');
      } else {
        stamp.textContent = 'VERIFIED';
        stamp.className = 'stamp stamp--verified';
        feedback.auditOk();
        showToast(`Audit saved: ${asset.asset_tag}`, 'ok');
      }
      stamp.classList.remove('hidden');

      // Log entry
      this.session.addEntry({
        tag: asset.asset_tag,
        name: asset.name || (asset.model && asset.model.name) || '',
        type: isMismatch ? 'bad' : 'ok',
        label: isMismatch ? 'Mismatch' : 'Verified',
        location: (asset.location && asset.location.name) || '',
        note,
      });

      // Update in Assets list if exists
      const listAsset = this.locationAssets.find(a => a.asset_tag === asset.asset_tag);
      if (listAsset) {
        listAsset.next_audit_date = { date: 'Audited in this session' }; // mark as audited locally
      }

      this.updateStats();
      if (this.activeView === 'viewAssets') this.renderAssetsList();
      
      setStatus($('actionStatus'), 'Saved to Snipe-IT ✓', 'ok');
      $('mismatchForm').classList.add('hidden');
      $('inputRemarks').value = '';

    } catch (err) {
      setStatus($('actionStatus'), `Failed: ${err.message}`, 'err');
      feedback.error();
      showToast(`Audit failed: ${err.message}`, 'err');
    }
  }

  // ─────────────────────────────────────────
  //  Assets List View
  // ─────────────────────────────────────────

  async fetchAssetsForLocation(locName) {
    if (!locName || !this.api) return;

    const locId = this.locations[locName];
    if (!locId) return;

    $('assetsSegmentControl').classList.add('hidden');
    $('listPending').innerHTML = '';
    $('listAudited').innerHTML = '';
    setStatus($('assetsStatus'), 'Fetching assets... please wait', '');

    try {
      // Progress callback to show loading state
      const onProgress = (loaded, total) => {
        setStatus($('assetsStatus'), `Loading... ${loaded} / ${total} assets`, '');
      };

      this.locationAssets = await this.api.getAllAssetsByLocation(locId, onProgress);
      setStatus($('assetsStatus'), '', ''); // Clear status
      $('assetsSegmentControl').classList.remove('hidden');
      this.renderAssetsList();
    } catch (err) {
      setStatus($('assetsStatus'), `Error: ${err.message}`, 'err');
      feedback.error();
    }
  }

  renderAssetsList() {
    const pendingList = $('listPending');
    const auditedList = $('listAudited');
    
    let pendingCount = 0;
    let auditedCount = 0;

    let pendingHtml = '';
    let auditedHtml = '';

    const now = new Date();

    this.locationAssets.forEach(asset => {
      // Logic for "audited"
      let isAudited = false;
      
      // If it was scanned in this session, we marked it manually above
      if (asset.next_audit_date?.date === 'Audited in this session') {
        isAudited = true;
      } else {
        // If next_audit_date is in the future, it is audited.
        if (asset.next_audit_date?.datetime) {
          const nextAudit = new Date(asset.next_audit_date.datetime);
          if (nextAudit > now) {
            isAudited = true;
          }
        }
      }

      const itemHtml = `
        <div class="asset-list-item">
          <div class="asset-list-item__info">
            <span class="asset-list-item__tag">${asset.asset_tag}</span>
            <span class="asset-list-item__name">${asset.name || (asset.model && asset.model.name) || '—'}</span>
          </div>
          <span class="badge badge--${isAudited ? 'ok' : 'pending'}">${isAudited ? 'Audited' : 'Pending'}</span>
        </div>
      `;

      if (isAudited) {
        auditedHtml += itemHtml;
        auditedCount++;
      } else {
        pendingHtml += itemHtml;
        pendingCount++;
      }
    });

    $('countPending').textContent = pendingCount;
    $('countAudited').textContent = auditedCount;

    if (pendingCount === 0) {
      pendingHtml = '<div class="empty-state">Sabhi assets audit ho gaye! 🎉</div>';
    }
    if (auditedCount === 0) {
      auditedHtml = '<div class="empty-state">No assets have been audited at this location</div>';
    }

    pendingList.innerHTML = pendingHtml;
    auditedList.innerHTML = auditedHtml;
  }

  // ─────────────────────────────────────────
  //  Session Log Rendering
  // ─────────────────────────────────────────

  renderLog(query = '') {
    const entries = this.session.search(query);
    const list = $('logList');
    const countEl = $('logCount');

    if (entries.length === 0) {
      list.innerHTML = `<div class="empty-state">${
        query ? 'No matches found' : 'No audits performed yet'
      }</div>`;
      if (countEl) countEl.textContent = '';
      return;
    }

    if (countEl) {
      countEl.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;
    }

    list.innerHTML = entries
      .map(
        (e) => `
        <div class="log-item">
          <span class="log-item__info">
            <span class="log-item__tag">${e.tag}</span>
            <span>${e.name ? e.name + ' · ' : ''}${e.time}</span>
          </span>
          <span class="badge badge--${e.type}">${e.label}</span>
        </div>`
      )
      .join('');
  }

  // ─────────────────────────────────────────
  //  Dashboard / Reports
  // ─────────────────────────────────────────

  renderDashboard() {
    const c = this.session.counts;

    // Stat cards
    $('dashScanned').textContent = c.scanned;
    $('dashVerified').textContent = c.verified;
    $('dashMismatch').textContent = c.mismatch;
    $('dashDuration').textContent = this.session.elapsedFormatted;

    // Success rate
    const rate = this.session.successRate;
    $('rateBarFill').style.width = `${rate}%`;
    $('ratePct').textContent = `${rate}%`;

    // Location breakdown
    const breakdown = this.session.locationBreakdown;
    const locContainer = $('locationBreakdown');
    const locEntries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);

    if (locEntries.length === 0) {
      locContainer.innerHTML =
        '<div class="empty-state">Location data will appear after audits</div>';
    } else {
      locContainer.innerHTML = locEntries
        .map(
          ([name, count]) => `
          <div class="loc-item">
            <span class="loc-item__name">${name}</span>
            <span class="loc-item__count">${count}</span>
          </div>`
        )
        .join('');
    }
  }

  // ─────────────────────────────────────────
  //  Stats Update
  // ─────────────────────────────────────────

  updateStats() {
    const c = this.session.counts;

    // Header stats
    $('statScanned').textContent = c.scanned;
    $('statVerified').textContent = c.verified;
    $('statMismatch').textContent = c.mismatch;

    // Animate dashboard cards if visible
    ['dashScanned', 'dashVerified', 'dashMismatch'].forEach((id) => {
      const el = $(id);
      if (el) {
        el.style.transform = 'scale(1.15)';
        setTimeout(() => (el.style.transform = 'scale(1)'), 200);
      }
    });
  }

  // ─────────────────────────────────────────
  //  Export
  // ─────────────────────────────────────────

  exportCSV() {
    if (this.session.isEmpty) {
      showToast('Please audit some assets before exporting!', 'info');
      return;
    }
    this.session.downloadCSV();
    showToast('CSV downloaded ✓', 'ok');
    feedback.tap();
  }

  exportJSON() {
    if (this.session.isEmpty) {
      showToast('Please audit some assets before exporting!', 'info');
      return;
    }
    this.session.downloadJSON();
    showToast('JSON downloaded ✓', 'ok');
    feedback.tap();
  }

  // ─────────────────────────────────────────
  //  Session Controls
  // ─────────────────────────────────────────

  resetSession() {
    if (
      !this.session.isEmpty &&
      !confirm('Current session ka data clear ho jaayega. Continue?')
    ) {
      return;
    }

    // Save before reset
    if (!this.session.isEmpty) {
      Storage.saveSession(this.session);
    }

    this.session.reset();
    this.currentAsset = null;
    this.updateStats();
    this.renderLog();
    $('assetCard').classList.add('hidden');

    // Restart timer
    this.session.startTimer((time) => {
      $('timerDisplay').textContent = time;
    });

    showToast('New session started', 'info');
    feedback.tap();
  }

  // ─────────────────────────────────────────
  //  Repair & Issue Modal Controls
  // ─────────────────────────────────────────

  populateRepairDropdowns() {
    // Repair categories
    const catSelect = $('repairCategory');
    for (const [group, categories] of Object.entries(REPAIR_CATEGORIES)) {
      const optGroup = document.createElement('optgroup');
      optGroup.label = group;
      categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        optGroup.appendChild(opt);
      });
      catSelect.appendChild(optGroup);
    }

    // Issue types
    const typeSelect = $('issueType');
    for (const [group, types] of Object.entries(ISSUE_TYPES)) {
      const optGroup = document.createElement('optgroup');
      optGroup.label = group;
      types.forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        optGroup.appendChild(opt);
      });
      typeSelect.appendChild(optGroup);
    }
  }

  openRepairModal(prefill = false) {
    // Set today's date
    $('repairDate').value = new Date().toISOString().slice(0, 10);
    // Prefill asset tag if from asset card
    if (prefill && this.currentAsset) {
      $('repairAssetTag').value = this.currentAsset.asset_tag;
      $('repairAssetTag').readOnly = true;
    } else {
      $('repairAssetTag').value = '';
      $('repairAssetTag').readOnly = false;
    }
    $('repairAmount').value = '';
    $('repairCategory').value = '';
    $('repairDescription').value = '';
    $('repairParts').value = '';
    setStatus($('repairModalStatus'), '', '');
    $('modalRepair').classList.remove('hidden');
    feedback.tap();
  }

  closeRepairModal() {
    $('modalRepair').classList.add('hidden');
  }

  openIssueModal(prefill = false) {
    if (prefill && this.currentAsset) {
      $('issueAssetTag').value = this.currentAsset.asset_tag;
      $('issueAssetTag').readOnly = true;
    } else {
      $('issueAssetTag').value = '';
      $('issueAssetTag').readOnly = false;
    }
    $('issueType').value = '';
    $('issueSeverity').value = '';
    $('issueDescription').value = '';
    setStatus($('issueModalStatus'), '', '');
    $('modalIssue').classList.remove('hidden');
    feedback.tap();
  }

  closeIssueModal() {
    $('modalIssue').classList.add('hidden');
  }

  // ─────────────────────────────────────────
  //  Repair Submit
  // ─────────────────────────────────────────

  // Map our categories to Snipe-IT maintenance types
  #mapCategoryToMaintenanceType(category) {
    const map = {
      // IT Equipment
      'Screen / Display Replace': 'Repair',
      'Keyboard / Mouse Replace': 'Repair',
      'Motherboard Repair': 'Repair',
      'RAM / Storage Upgrade': 'Upgrade',
      'CPU / Thermal Paste': 'Maintenance',
      'Power Supply (PSU) Replace': 'Hardware Support',
      'Charger / Adapter Replace': 'Hardware Support',
      'Battery Replace': 'Repair',
      'OS / Software Install': 'Software Support',
      'Antivirus / Security': 'Software Support',
      'Networking / Wi-Fi Card': 'Hardware Support',
      'Casing / Hinge Repair': 'Repair',
      'Data Recovery': 'Software Support',
      'Hardware Cleaning': 'Maintenance',
      
      'General Maintenance': 'Maintenance',
      'Other': 'Repair',
    };
    return map[category] || 'Repair';
  }

  async #getMaintenanceTypeId(typeName) {
    if (!this.api) return null;
    
    // Cache the types if we haven't already
    if (!this._maintenanceTypesCache) {
      try {
        const res = await this.api.getMaintenanceTypes();
        if (res && res.rows) {
          this._maintenanceTypesCache = res.rows;
        } else {
          this._maintenanceTypesCache = [];
        }
      } catch (e) {
        console.warn('Failed to fetch maintenance types', e);
        this._maintenanceTypesCache = [];
      }
    }
    
    // Find the type by name (case-insensitive)
    const found = this._maintenanceTypesCache.find(t => t.name.toLowerCase() === typeName.toLowerCase());
    return found ? found.id : null;
  }

  async submitRepair() {
    const tag = $('repairAssetTag').value.trim();
    const date = $('repairDate').value;
    const category = $('repairCategory').value;
    const amount = $('repairAmount').value;
    const description = $('repairDescription').value.trim();
    const parts = $('repairParts').value.trim();

    if (!tag) {
      setStatus($('repairModalStatus'), 'Please enter an asset tag', 'err');
      return;
    }
    if (!date) {
      setStatus($('repairModalStatus'), 'Please select a date', 'err');
      return;
    }
    if (!category) {
      setStatus($('repairModalStatus'), 'Please select a category', 'err');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setStatus($('repairModalStatus'), 'Please enter a valid amount (₹)', 'err');
      return;
    }
    if (!description) {
      setStatus($('repairModalStatus'), 'Description likho', 'err');
      return;
    }

    // Get asset name and ID
    let assetName = '';
    let assetId = null;
    if (this.currentAsset && this.currentAsset.asset_tag === tag) {
      assetName = this.currentAsset.name || (this.currentAsset.model && this.currentAsset.model.name) || '';
      assetId = this.currentAsset.id;
    }

    // Save locally
    this.repairs.add({
      asset_tag: tag,
      asset_name: assetName,
      date,
      category,
      amount: Number(amount),
      description,
      parts,
    });

    showToast(`Repair saved locally: ${tag} — ₹${Number(amount).toLocaleString('en-IN')}`, 'ok');
    feedback.auditOk();
    this.closeRepairModal();

    // Update asset card if same asset
    if (this.currentAsset && this.currentAsset.asset_tag === tag) {
      $('tagRepairCost').textContent = '₹' + this.repairs.getTotalCost(tag).toLocaleString('en-IN');
      $('tagRepairCount').textContent = this.repairs.getCount(tag);
    }

    // Refresh repairs view if visible
    if (this.activeView === 'viewRepairs') this.renderRepairsView();

    // ── Sync to Snipe-IT ──
    if (this.api && assetId) {
      try {
        const maintenanceType = this.#mapCategoryToMaintenanceType(category);
        const maintenanceTypeId = await this.#getMaintenanceTypeId(maintenanceType);
        
        if (!maintenanceTypeId) {
          alert(`Warning: Maintenance Type ID for '${maintenanceType}' could not be found! The sync might fail.`);
        }
        
        const notesText = `${description}${parts ? '\nParts: ' + parts : ''}`;

        // Fetch suppliers to get a valid supplier_id, or create one if none exists
        let supplierId = undefined;
        try {
          const suppliers = await this.api.getSuppliers(1);
          if (suppliers && suppliers.rows && suppliers.rows.length > 0) {
            supplierId = suppliers.rows[0].id;
          } else {
            // Create a default supplier since it is strictly required by Snipe-IT
            const newSup = await this.api.createSupplier('Baaz Internal Repair');
            supplierId = newSup.payload ? newSup.payload.id : newSup.id;
          }
        } catch (e) {
          console.warn('Could not fetch or create supplier for maintenance record', e);
        }

        await this.api.createMaintenance({
          title: `${category} — ${tag}`,
          name: `${category} — ${tag}`,
          asset_id: assetId,
          supplier_id: supplierId,
          asset_maintenance_type: maintenanceType,
          asset_maintenance_type_id: maintenanceTypeId,
          maintenance_type_id: maintenanceTypeId,
          start_date: date,
          completion_date: date,  // Repair is completed
          cost: Number(amount),
          notes: notesText,
          is_warranty: false,
        });

        showToast(`✅ Snipe-IT me bhi save hua: ${tag}`, 'ok');
      } catch (err) {
        console.error('Snipe-IT sync failed:', err);
        showToast(`⚠ Locally saved, lekin Snipe-IT sync fail: ${err.message}`, 'warn', 5000);
        alert(`API Error: ${err.message}\nPlease take a screenshot of this error.`);
      }
    } else if (this.api && !assetId) {
      showToast('💡 Please scan the asset first to add a repair for Snipe-IT sync', 'info', 4000);
    }
  }

  // ─────────────────────────────────────────
  //  Issue Submit
  // ─────────────────────────────────────────

  // Map issue types to Snipe-IT maintenance types
  #mapIssueTypeToMaintenanceType(issueType) {
    const map = {
      // IT Equipment
      'Display / Monitor Issue': 'Repair',
      'Keyboard / Mouse Not Working': 'Repair',
      'Power / Battery Drain': 'Hardware Support',
      'Heating / Fan Noise': 'Hardware Support',
      'Slow Performance / Lag': 'Software Support',
      'Software / OS Crash (BSOD)': 'Software Support',
      'Network / Connectivity': 'Hardware Support',
      'Storage / Hard Drive Failure': 'Repair',
      'Audio / Speaker Issue': 'Repair',
      'Peripheral / Port Issue': 'Hardware Support',
      
      'Software / Display': 'Software Support',
      'Other': 'Maintenance',
    };
    return map[issueType] || 'Maintenance';
  }

  async submitIssue() {
    const tag = $('issueAssetTag').value.trim();
    const type = $('issueType').value;
    const severity = $('issueSeverity').value;
    const description = $('issueDescription').value.trim();

    if (!tag) {
      setStatus($('issueModalStatus'), 'Please enter an asset tag', 'err');
      return;
    }
    if (!type) {
      setStatus($('issueModalStatus'), 'Please choose an issue type', 'err');
      return;
    }
    if (!severity) {
      setStatus($('issueModalStatus'), 'Please choose a severity', 'err');
      return;
    }
    if (!description) {
      setStatus($('issueModalStatus'), 'Please describe the problem', 'err');
      return;
    }

    let assetName = '';
    let assetId = null;
    if (this.currentAsset && this.currentAsset.asset_tag === tag) {
      assetName = this.currentAsset.name || (this.currentAsset.model && this.currentAsset.model.name) || '';
      assetId = this.currentAsset.id;
    }

    // Save locally
    this.issues.add({
      asset_tag: tag,
      asset_name: assetName,
      type,
      severity,
      description,
    });

    const sevEmoji = { critical: '🔴', medium: '🟡', low: '🔵' };
    const sevLabel = { critical: 'CRITICAL', medium: 'MEDIUM', low: 'LOW' };
    showToast(`Issue reported: ${tag} — ${sevEmoji[severity] || ''} ${type}`, 'ok');
    feedback.auditOk();
    this.closeIssueModal();

    // Update asset card if same asset
    if (this.currentAsset && this.currentAsset.asset_tag === tag) {
      $('tagIssueCount').textContent = this.issues.getOpenCount(tag);
    }

    if (this.activeView === 'viewRepairs') this.renderRepairsView();

    // ── Sync to Snipe-IT as Active Maintenance (no completion_date = ongoing) ──
    if (this.api && assetId) {
      try {
        const maintenanceType = this.#mapIssueTypeToMaintenanceType(type);
        const maintenanceTypeId = await this.#getMaintenanceTypeId(maintenanceType);

        if (!maintenanceTypeId) {
          alert(`Warning: Maintenance Type ID for '${maintenanceType}' could not be found! The sync might fail.`);
        }

        // Fetch suppliers to get a valid supplier_id, or create one if none exists
        let supplierId = undefined;
        try {
          const suppliers = await this.api.getSuppliers(1);
          if (suppliers && suppliers.rows && suppliers.rows.length > 0) {
            supplierId = suppliers.rows[0].id;
          } else {
            // Create a default supplier since it is strictly required by Snipe-IT
            const newSup = await this.api.createSupplier('Baaz Internal Repair');
            supplierId = newSup.payload ? newSup.payload.id : newSup.id;
          }
        } catch (e) {
          console.warn('Could not fetch or create supplier for maintenance record', e);
        }

        await this.api.createMaintenance({
          title: `[ISSUE ${sevLabel[severity] || severity}] ${type} — ${tag}`,
          name: `[ISSUE ${sevLabel[severity] || severity}] ${type} — ${tag}`,
          asset_id: assetId,
          supplier_id: supplierId,
          asset_maintenance_type: maintenanceType,
          asset_maintenance_type_id: maintenanceTypeId,
          maintenance_type_id: maintenanceTypeId,
          start_date: new Date().toISOString().slice(0, 10),
          completion_date: null,  // No completion = Active/Ongoing issue
          cost: 0,
          notes: `[${sevLabel[severity] || severity}] ${description}`,
          is_warranty: false,
        });

        showToast(`✅ Issue saved to Snipe-IT (Active Maintenance): ${tag}`, 'ok');
      } catch (err) {
        console.error('Snipe-IT issue sync failed:', err);
        showToast(`⚠ Saved locally, but Snipe-IT sync failed: ${err.message}`, 'warn', 5000);
        alert(`API Error: ${err.message}\nPlease take a screenshot of this error.`);
      }
    } else if (this.api && !assetId) {
      showToast('💡 Please scan the asset first to report an issue', 'info', 4000);
    }
  }

  // ─────────────────────────────────────────
  //  Snipe-IT Advanced Integrations
  // ─────────────────────────────────────────

  async submitOfficialAudit() {
    if (!this.api || !this.currentAsset) {
      showToast('API not connected or no asset selected.', 'err');
      return;
    }
    const tag = this.currentAsset.asset_tag;
    if (!confirm(`Are you sure you want to log an official Snipe-IT audit for ${tag}?`)) return;

    setLoading(true, 'Logging Audit...');
    try {
      // Set next audit date to 6 months from now
      const nextDate = new Date();
      nextDate.setMonth(nextDate.getMonth() + 6);
      const nextDateString = nextDate.toISOString().slice(0, 10);

      await this.api.logAudit(tag, nextDateString, 'Audited via Baaz Scanner');
      showToast(`✅ Official Audit logged for ${tag}`, 'ok');
      
      // Update local asset card
      $('tagLastAudit').textContent = new Date().toISOString().slice(0, 10);
    } catch (err) {
      console.error(err);
      showToast(`⚠ Audit failed: ${err.message}`, 'err');
    } finally {
      setLoading(false);
    }
  }

  // --- Checkout ---
  async openCheckoutModal() {
    if (!this.api || !this.currentAsset) {
      showToast('API not connected or no asset selected.', 'err');
      return;
    }
    $('modalCheckout').classList.remove('hidden');
    $('checkoutNotes').value = '';
    
    // Fetch users if not already fetched
    if (!this.usersCache) {
      const select = $('checkoutUser');
      select.innerHTML = '<option value="">— Loading users... —</option>';
      try {
        const res = await this.api.getUsers();
        this.usersCache = res.rows || [];
        select.innerHTML = '<option value="">— Select User —</option>';
        this.usersCache.forEach(u => {
          const opt = document.createElement('option');
          opt.value = u.id;
          opt.textContent = `${u.name} (${u.email || u.username || ''})`;
          select.appendChild(opt);
        });
      } catch (err) {
        select.innerHTML = '<option value="">Failed to load</option>';
      }
    }
  }

  closeCheckoutModal() {
    $('modalCheckout').classList.add('hidden');
  }

  async submitCheckout() {
    const userId = $('checkoutUser').value;
    const notes = $('checkoutNotes').value.trim();
    if (!userId) {
      setStatus($('checkoutModalStatus'), 'Please choose a user', 'err');
      return;
    }

    setLoading(true, 'Checking out...');
    try {
      await this.api.checkoutAsset(this.currentAsset.id, userId, null, null, notes);
      showToast('✅ Asset Checked out successfully', 'ok');
      this.closeCheckoutModal();
      
      // We can optimistically update the tag Assigned user name
      const user = this.usersCache.find(u => u.id == userId);
      if (user) {
        $('tagAssigned').textContent = user.name;
        $('tagStatusLabel').textContent = 'Deployed';
      }
    } catch (err) {
      setStatus($('checkoutModalStatus'), `Failed: ${err.message}`, 'err');
    } finally {
      setLoading(false);
    }
  }

  // --- Checkin ---
  async submitCheckin() {
    if (!this.api || !this.currentAsset) {
      showToast('API not connected or no asset selected.', 'err');
      return;
    }
    if (!confirm(`Are you sure you want to Check-in ${this.currentAsset.asset_tag}?`)) return;

    setLoading(true, 'Checking in...');
    try {
      await this.api.checkinAsset(this.currentAsset.id, 'Checked in via Scanner');
      showToast('✅ Asset Checked in', 'ok');
      $('tagAssigned').textContent = '—';
      $('tagStatusLabel').textContent = 'Ready to Deploy';
    } catch (err) {
      console.error(err);
      showToast(`⚠ Check-in failed: ${err.message}`, 'err');
    } finally {
      setLoading(false);
    }
  }

  // --- Status ---
  async openStatusModal() {
    if (!this.api || !this.currentAsset) {
      showToast('API not connected or no asset selected.', 'err');
      return;
    }
    $('modalStatus').classList.remove('hidden');

    if (!this.statusCache) {
      const select = $('statusSelect');
      select.innerHTML = '<option value="">— Loading statuses... —</option>';
      try {
        const res = await this.api.getStatusLabels();
        this.statusCache = res.rows || [];
        select.innerHTML = '<option value="">— Select Status —</option>';
        this.statusCache.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.type})`;
          select.appendChild(opt);
        });
      } catch (err) {
        select.innerHTML = '<option value="">Failed to load</option>';
      }
    }
  }

  closeStatusModal() {
    $('modalStatus').classList.add('hidden');
  }

  async submitStatus() {
    const statusId = $('statusSelect').value;
    if (!statusId) {
      setStatus($('statusModalStatus'), 'Please choose a status', 'err');
      return;
    }
    
    setLoading(true, 'Updating Status...');
    try {
      await this.api.updateAssetStatus(this.currentAsset.id, statusId);
      showToast('✅ Status updated successfully', 'ok');
      this.closeStatusModal();
      
      const st = this.statusCache.find(s => s.id == statusId);
      if (st) $('tagStatusLabel').textContent = st.name;
    } catch (err) {
      setStatus($('statusModalStatus'), `Failed: ${err.message}`, 'err');
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────
  //  Repairs & Issues View Rendering
  // ─────────────────────────────────────────

  renderRepairsView(query = '') {
    // Update summary cards
    $('repairTotalCost').textContent = '₹' + this.repairs.getGrandTotal().toLocaleString('en-IN');
    $('repairTotalCount').textContent = this.repairs.totalCount;
    $('issueOpenCount').textContent = this.issues.getOpenCount();

    this.renderRepairHistory(query);
    this.renderIssuesList(query);
    this.renderTopExpensiveAssets();
  }

  renderRepairHistory(query = '') {
    const repairs = this.repairs.search(query);
    const list = $('repairHistoryList');

    if (repairs.length === 0) {
      list.innerHTML = `<div class="empty-state">${query ? 'No matches found' : 'No repair records yet'}</div>`;
      return;
    }

    list.innerHTML = repairs.map(r => `
      <div class="repair-item">
        <div class="repair-item__info">
          <div class="repair-item__tag">${r.asset_tag} ${r.asset_name ? '· ' + r.asset_name : ''}</div>
          <div class="repair-item__cat">${r.category}</div>
          <div class="repair-item__desc">${r.description}</div>
          ${r.parts ? `<div class="repair-item__date">Parts: ${r.parts}</div>` : ''}
          <div class="repair-item__date">${r.date}</div>
        </div>
        <div class="repair-item__actions">
          <div class="repair-item__cost">₹${r.amount.toLocaleString('en-IN')}</div>
          <button class="repair-item__delete" data-repair-id="${r.id}" title="Delete">🗑</button>
        </div>
      </div>
    `).join('');

    // Bind delete buttons
    list.querySelectorAll('.repair-item__delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Are you sure you want to delete this record?')) {
          this.repairs.delete(btn.dataset.repairId);
          showToast('Repair deleted', 'info');
          this.renderRepairsView($('inputRepairSearch').value.trim());
          // Update asset card if visible
          if (this.currentAsset) {
            $('tagRepairCost').textContent = '₹' + this.repairs.getTotalCost(this.currentAsset.asset_tag).toLocaleString('en-IN');
            $('tagRepairCount').textContent = this.repairs.getCount(this.currentAsset.asset_tag);
          }
        }
      });
    });
  }

  renderIssuesList(query = '') {
    const issues = this.issues.search(query);
    const list = $('issuesList');

    if (issues.length === 0) {
      list.innerHTML = `<div class="empty-state">${query ? 'No matches found' : 'No issues reported yet'}</div>`;
      return;
    }

    const sevEmoji = { critical: '🔴', medium: '🟡', low: '🔵' };
    const sevLabel = { critical: 'Critical', medium: 'Medium', low: 'Low' };

    list.innerHTML = issues.map(i => `
      <div class="issue-item">
        <div class="issue-item__top">
          <div>
            <div class="issue-item__tag">${i.asset_tag} ${i.asset_name ? '· ' + i.asset_name : ''}</div>
            <div class="issue-item__type">${i.type}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span class="severity-badge severity-badge--${i.severity}">${sevEmoji[i.severity] || ''} ${sevLabel[i.severity] || i.severity}</span>
            <span class="issue-status issue-status--${i.status}">${i.status === 'open' ? '🔴 Open' : '✅ Resolved'}</span>
          </div>
        </div>
        <div class="issue-item__desc">${i.description}</div>
        <div class="issue-item__bottom">
          <div class="issue-item__date">${new Date(i.created_at).toLocaleDateString()}
            ${i.resolved_at ? ' → Resolved: ' + new Date(i.resolved_at).toLocaleDateString() : ''}
          </div>
          <div class="issue-item__actions">
            ${i.status === 'open'
              ? `<button class="issue-item__btn issue-item__btn--resolve" data-issue-id="${i.id}" data-action="resolve">✅ Resolve</button>`
              : `<button class="issue-item__btn issue-item__btn--reopen" data-issue-id="${i.id}" data-action="reopen">🔄 Reopen</button>`
            }
            <button class="issue-item__btn issue-item__btn--delete" data-issue-id="${i.id}" data-action="delete">🗑</button>
          </div>
        </div>
      </div>
    `).join('');

    // Bind action buttons
    list.querySelectorAll('.issue-item__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.issueId;
        const action = btn.dataset.action;
        if (action === 'resolve') {
          this.issues.resolve(id);
          showToast('Issue resolved ✅', 'ok');
        } else if (action === 'reopen') {
          this.issues.reopen(id);
          showToast('Issue reopened', 'info');
        } else if (action === 'delete') {
          if (confirm('Are you sure you want to delete this issue?')) {
            this.issues.delete(id);
            showToast('Issue deleted', 'info');
          }
        }
        this.renderRepairsView($('inputRepairSearch').value.trim());
        // Update asset card if visible
        if (this.currentAsset) {
          $('tagIssueCount').textContent = this.issues.getOpenCount(this.currentAsset.asset_tag);
        }
      });
    });
  }

  renderTopExpensiveAssets() {
    const top = this.repairs.getTopExpensiveAssets(10);
    const list = $('topAssetsList');

    if (top.length === 0) {
      list.innerHTML = '<div class="empty-state">Repair data aane pe yahan top expensive assets dikhenge</div>';
      return;
    }

    list.innerHTML = top.map((a, i) => `
      <div class="top-asset-item">
        <div class="top-asset-item__rank">${i + 1}</div>
        <div class="top-asset-item__info">
          <div class="top-asset-item__tag">${a.tag}</div>
          <div class="top-asset-item__name">${a.name || '—'}</div>
        </div>
        <div>
          <div class="top-asset-item__cost">₹${a.total.toLocaleString('en-IN')}</div>
          <div class="top-asset-item__count">${a.count} repair${a.count > 1 ? 's' : ''}</div>
        </div>
      </div>
    `).join('');
  }

  // ─────────────────────────────────────────
  //  Repair & Issue Export
  // ─────────────────────────────────────────

  exportRepairCSV() {
    if (this.repairs.totalCount === 0) {
      showToast('No repair data available to export!', 'info');
      return;
    }
    downloadFile(
      this.repairs.exportCSV(),
      `baaz_repairs_${new Date().toISOString().slice(0, 10)}.csv`
    );
    showToast('Repairs CSV downloaded ✓', 'ok');
    feedback.tap();
  }

  exportIssuesCSV() {
    if (this.issues.totalCount === 0) {
      showToast('No issue data available to export!', 'info');
      return;
    }
    downloadFile(
      this.issues.exportCSV(),
      `baaz_issues_${new Date().toISOString().slice(0, 10)}.csv`
    );
    showToast('Issues CSV downloaded ✓', 'ok');
    feedback.tap();
  }
}

// ─── Bootstrap ───
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();

  // Expose for debugging (optional, remove in prod)
  window.__baazApp = app;
});
