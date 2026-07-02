const API_BASE = import.meta.env.VITE_API_URL || '';
const WS_BASE =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

const TOKEN_KEY = 'campus_energy_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('auth:logout'));
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = err.detail;
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail[0]?.msg : 'Request failed';
    throw new Error(message || 'Request failed');
  }

  if (res.status === 204) {
    return null;
  }

  if (res.headers.get('content-type')?.includes('text/csv')) {
    return res;
  }
  return res.json();
}

export async function signup(data) {
  return request('/api/auth/signup', { method: 'POST', body: JSON.stringify(data) });
}

export async function signin(data) {
  return request('/api/auth/signin', { method: 'POST', body: JSON.stringify(data) });
}

export async function fetchMe() {
  return request('/api/auth/me');
}

export async function fetchOverview() {
  return request('/');
}

export async function fetchDashboardOverview() {
  return request('/api/dashboard/overview');
}

export async function fetchDashboardTrend() {
  return request('/api/dashboard/trend');
}

export async function fetchAlerts() {
  return request('/api/alerts');
}

export async function fetchAdminStats() {
  return request('/api/admin/stats');
}

export async function fetchBuildings() {
  return request('/api/buildings');
}

export async function addBuilding(data) {
  return request('/api/buildings', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteBuilding(buildingId) {
  return request(`/api/buildings/${buildingId}`, { method: 'DELETE' });
}

export async function fetchEnergyData() {
  return request('/api/energy');
}

export async function refreshEnergyData() {
  return request('/api/energy/refresh', { method: 'POST' });
}

export async function runAIPredictions() {
  return request('/api/predictions/run', { method: 'POST' });
}

export async function fetchPredictions() {
  return request('/api/predictions');
}

export async function exportReport() {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/export/report`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || 'campus_energy_report.csv';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function connectWebSocket(onMessage) {
  const ws = new WebSocket(`${WS_BASE}/ws`);
  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch {
      /* ignore */
    }
  };
  return ws;
}
