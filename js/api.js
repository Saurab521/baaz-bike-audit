/**
 * ═══════════════════════════════════════════════
 *  Snipe-IT API Service
 *  Handles all REST API communication
 * ═══════════════════════════════════════════════
 */

export class APIError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.details = details;
  }
}

export class SnipeAPI {
  #baseUrl;
  #token;

  /**
   * @param {string} baseUrl - Snipe-IT instance URL (e.g. https://assets.example.com)
   * @param {string} token   - Personal Access Token from Snipe-IT
   */
  constructor(baseUrl, token) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#token = token;
  }

  get baseUrl() {
    return this.#baseUrl;
  }

  /**
   * Core request method — all API calls go through here.
   * Routes through /proxy to avoid browser CORS issues.
   */
  async #request(path, options = {}) {
    const targetUrl = `${this.#baseUrl}/api/v1${path}`;
    // Route through local CORS proxy
    const proxyUrl = `/proxy?target=${encodeURIComponent(targetUrl)}`;

    try {
      const response = await fetch(proxyUrl, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.#token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });

      let data = null;
      const text = await response.text();
      try { data = JSON.parse(text); } catch { /* non-JSON response */ }

      if (!response.ok) {
        // Friendly error messages for common status codes
        if (response.status === 401) {
          throw new APIError(401,
            'Token is invalid or expired. Go to Snipe-IT Admin → API Keys to generate a new Personal Access Token.',
            data
          );
        }
        if (response.status === 403) {
          throw new APIError(403,
            'Permission denied — this token does not have access to this API. Check permissions with your admin.',
            data
          );
        }
        if (response.status === 404) {
          throw new APIError(404,
            data?.messages || 'Resource not found — check URL or asset tag.',
            data
          );
        }
        if (response.status === 429) {
          throw new APIError(429, 'Rate limit hit — please wait and try again.', data);
        }
        if (response.status >= 500) {
          throw new APIError(response.status, 'Snipe-IT server error — the server might be down.', data);
        }
        let msg = data?.error || `HTTP ${response.status} ${response.statusText}`;
        if (data?.messages) {
          msg = typeof data.messages === 'string' 
            ? data.messages 
            : Object.values(data.messages).join(' | ');
        }
        throw new APIError(response.status, msg, data);
      }

      if (data?.status === 'error') {
        let errorMsg = 'Unknown Snipe-IT error';
        if (data.messages) {
          errorMsg = typeof data.messages === 'string' 
            ? data.messages 
            : Object.values(data.messages).join(' | ');
        }
        throw new APIError(400, errorMsg, data);
      }

      return data;
    } catch (err) {
      if (err instanceof APIError) throw err;

      // Network / CORS errors
      if (err.name === 'TypeError') {
        throw new APIError(
          0,
          `Network error — unable to connect. Check if the server URL is correct. Details: ${err.message}`
        );
      }
      throw new APIError(0, err.message);
    }
  }

  // ─────────────────────────────────────────
  //  Connection
  // ─────────────────────────────────────────

  /** Test if the connection and token are valid */
  async testConnection() {
    const data = await this.#request('/hardware?limit=1');
    return {
      ok: true,
      total: data.total || 0,
    };
  }

  async testEndpoint(ep) {
    return this.#request(ep);
  }

  // ─────────────────────────────────────────
  //  Hardware / Assets
  // ─────────────────────────────────────────

  /** Search by Asset Tag */
  async getAssetByTag(tag) {
    return this.#request(`/hardware/bytag/${encodeURIComponent(tag)}`);
  }

  /** Search by database ID (used when Snipe-IT QR code is a URL ending in ID) */
  async getAssetById(id) {
    try {
      return await this.#request(`/hardware/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err.status === 404) {
        // Fallback: search endpoint might return it if the direct endpoint is buggy
        try {
          const searchRes = await this.#request(`/hardware?search=${encodeURIComponent(id)}&limit=50`);
          if (searchRes && searchRes.rows) {
            const match = searchRes.rows.find(a => String(a.id) === String(id));
            if (match) return match;
          }
        } catch (searchErr) {
          // Ignore search error, throw original 404
        }
      }
      throw err;
    }
  }

  /** Get an asset by its serial number */
  async getAssetBySerial(serial) {
    return this.#request(`/hardware/byserial/${encodeURIComponent(serial)}`);
  }

  /** Search assets by keyword */
  async searchAssets(query, limit = 20) {
    return this.#request(
      `/hardware?search=${encodeURIComponent(query)}&limit=${limit}&sort=asset_tag&order=asc`
    );
  }

  /** List assets with pagination and optional location filter */
  async listAssets({ limit = 50, offset = 0, sort = 'asset_tag', order = 'asc', location_id = null } = {}) {
    let url = `/hardware?limit=${limit}&offset=${offset}&sort=${sort}&order=${order}`;
    if (location_id) {
      url += `&location_id=${location_id}`;
    }
    return this.#request(url);
  }

  /** Fetch all assets for a given location, handling pagination automatically */
  async getAllAssetsByLocation(location_id, onProgress = null) {
    let allAssets = [];
    let offset = 0;
    const limit = 200; // Max allowed by Snipe-IT API usually
    let hasMore = true;

    while (hasMore) {
      const data = await this.listAssets({ limit, offset, location_id });
      if (data && data.rows && data.rows.length > 0) {
        allAssets = allAssets.concat(data.rows);
        offset += limit;
        if (onProgress) onProgress(allAssets.length, data.total);
        if (allAssets.length >= data.total) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    return allAssets;
  }

  // ─────────────────────────────────────────
  //  Audit
  // ─────────────────────────────────────────

  /**
   * Submit an audit for an asset
   * @param {number} assetId         - The hardware ID
   * @param {object} options
   * @param {string} options.note          - Audit note
   * @param {number} options.locationId    - Override location (for mismatch)
   * @param {string} options.nextAuditDate - Next audit date (YYYY-MM-DD)
   */
  async auditAsset(assetId, { note = '', locationId = null, nextAuditDate = null } = {}) {
    const payload = {};

    if (note) payload.note = note;
    if (locationId) payload.location_id = locationId;

    if (nextAuditDate) {
      payload.next_audit_date = nextAuditDate;
    } else {
      // Default: next audit in 1 year
      const next = new Date();
      next.setFullYear(next.getFullYear() + 1);
      payload.next_audit_date = next.toISOString().slice(0, 10);
    }

    return this.#request(`/hardware/${assetId}/audit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ─────────────────────────────────────────
  //  Locations
  // ─────────────────────────────────────────

  /** Get all locations (for mismatch dropdown) */
  async getLocations(limit = 500) {
    return this.#request(`/locations?limit=${limit}&sort=name&order=asc`);
  }

  /** Get a single location by ID */
  async getLocationById(id) {
    return this.#request(`/locations/${id}`);
  }

  // ─────────────────────────────────────────
  //  Status Labels
  // ─────────────────────────────────────────

  /** Get all status labels */
  async getStatusLabels(limit = 100) {
    return this.#request(`/statuslabels?limit=${limit}`);
  }

  // ─────────────────────────────────────────
  //  Categories
  // ─────────────────────────────────────────

  /** Get all categories */
  async getCategories(limit = 100) {
    return this.#request(`/categories?limit=${limit}&sort=name&order=asc`);
  }

  // ─────────────────────────────────────────
  //  Models
  // ─────────────────────────────────────────

  /** Get all asset models */
  async getModels(limit = 100) {
    return this.#request(`/models?limit=${limit}&sort=name&order=asc`);
  }

  // ─────────────────────────────────────────
  //  Users
  // ─────────────────────────────────────────

  /** Get all users */
  async getUsers(limit = 100) {
    return this.#request(`/users?limit=${limit}&sort=last_name&order=asc`);
  }

  // ─────────────────────────────────────────
  //  Maintenance
  // ─────────────────────────────────────────

  /** Get maintenance records for an asset */
  async getMaintenances(assetId) {
    return this.#request(`/maintenances?asset_id=${assetId}&limit=50`);
  }

  /** Get maintenance types (used in Snipe-IT v6+) */
  async getMaintenanceTypes() {
    return this.#request('/maintenance-types?limit=100');
  }

  /**
   * Create a new maintenance record in Snipe-IT
   * @param {object} data
   * @param {string} data.name                     - Title/name of the maintenance
   * @param {number} [data.asset_maintenance_type_id] - New v6+ ID field
   * @param {number} [data.maintenance_type_id] - New v6+ ID field
   * @param {string} data.start_date               - YYYY-MM-DD
   * @param {string} [data.completion_date]         - YYYY-MM-DD (optional, null = active/ongoing)
   * @param {number} [data.cost]                    - Cost amount
   * @param {string} [data.notes]                   - Additional notes
   * @param {boolean} [data.is_warranty]            - Whether under warranty
   */
  async createMaintenance({ title, name, asset_id, supplier_id, asset_maintenance_type, asset_maintenance_type_id, maintenance_type_id, start_date, completion_date = null, cost = null, notes = '', is_warranty = false }) {
    const payload = {
      title: title || name,
      name: name || title,
      asset_id,
      asset_maintenance_type,
      start_date,
      is_warranty,
    };

    if (asset_maintenance_type_id) payload.asset_maintenance_type_id = asset_maintenance_type_id;
    if (maintenance_type_id) payload.maintenance_type_id = maintenance_type_id;
    if (supplier_id) payload.supplier_id = supplier_id;
    if (completion_date) payload.completion_date = completion_date;
    if (cost !== null && cost !== undefined) payload.cost = cost;
    if (notes) payload.notes = notes;

    return this.#request('/maintenances', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ─────────────────────────────────────────
  //  Suppliers
  // ─────────────────────────────────────────

  /** Get all suppliers (for maintenance records) */
  async getSuppliers(limit = 100) {
    return this.#request(`/suppliers?limit=${limit}&sort=name&order=asc`);
  }

  /** Create a new supplier */
  async createSupplier(name) {
    return this.#request('/suppliers', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  // ─────────────────────────────────────────
  //  Advanced Integrations (Audit, Checkout, Status)
  // ─────────────────────────────────────────

  /** Log an official Snipe-IT Audit */
  async logAudit(asset_tag, next_audit_date = null, notes = '') {
    const payload = { asset_tag, notes };
    if (next_audit_date) payload.next_audit_date = next_audit_date;
    
    return this.#request('/hardware/audit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Get users for checkout */
  async getUsers(limit = 200) {
    return this.#request(`/users?limit=${limit}&sort=name&order=asc`);
  }

  /** Checkout asset to a user */
  async checkoutAsset(asset_id, assigned_user, checkout_at = null, expected_checkin = null, note = '') {
    const payload = {
      checkout_to_type: 'user',
      assigned_user,
      note
    };
    if (checkout_at) payload.checkout_at = checkout_at;
    if (expected_checkin) payload.expected_checkin = expected_checkin;

    return this.#request(`/hardware/${asset_id}/checkout`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Check-in an asset */
  async checkinAsset(asset_id, note = '') {
    const payload = { note };
    return this.#request(`/hardware/${asset_id}/checkin`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Get status labels */
  async getStatusLabels() {
    return this.#request('/statuslabels');
  }

  /** Update asset status */
  async updateAssetStatus(asset_id, status_id) {
    return this.#request(`/hardware/${asset_id}`, {
      method: 'PATCH', // or PUT, Snipe-IT supports both
      body: JSON.stringify({ status_id }),
    });
  }
}
