import { useCallback, useEffect, useState } from 'react';
import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';
import {
  addBuilding,
  deleteBuilding,
  exportReport,
  fetchAdminStats,
  refreshEnergyData,
  runAIPredictions,
} from '../services/api';

function Admin({ searchQuery = '' }) {
  const { buildings, predictions, liveStatus, refresh } = useCampusData();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState('');
  const [toast, setToast] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', status: 'Active' });

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      setStats(await fetchAdminStats());
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [showToast]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleAddBuilding = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const buildingName = form.name.trim();
    setLoading('add');
    try {
      await addBuilding({ ...form, name: buildingName });
      setForm({ name: '', description: '', status: 'Active' });
      setShowAddForm(false);
      await Promise.all([refresh(), loadStats()]);
      showToast(`Building "${buildingName}" added successfully`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleRunPrediction = async () => {
    setLoading('predict');
    try {
      const results = await runAIPredictions();
      await Promise.all([refresh(), loadStats()]);
      showToast(`AI predictions completed for ${results.length} building(s)`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleRefreshEnergy = async () => {
    setLoading('refresh');
    try {
      const result = await refreshEnergyData();
      await Promise.all([refresh(), loadStats()]);
      showToast(`Refreshed energy data for ${result.count} building(s)`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleDeleteBuilding = async (buildingId, buildingName) => {
    const confirmed = window.confirm(`Delete building \"${buildingName}\"? This will remove only this building and its related data.`);
    if (!confirmed) return;

    setLoading('delete');
    try {
      await deleteBuilding(buildingId);
      await Promise.all([refresh(), loadStats()]);
      showToast(`Building "${buildingName}" deleted`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleExport = async () => {
    setLoading('export');
    try {
      await exportReport();
      showToast('Report exported successfully');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const formatTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
  const query = searchQuery.trim().toLowerCase();

  const filteredBuildings = query
    ? buildings.filter((building) => {
        const haystack = [building.name, building.description, building.status].join(' ').toLowerCase();
        return haystack.includes(query);
      })
    : buildings;

  const filteredPredictions = query
    ? predictions.filter((prediction) => {
        const haystack = [prediction.building_name, String(prediction.meter), String(prediction.predicted_energy)].join(' ').toLowerCase();
        return haystack.includes(query);
      })
    : predictions;

  const displayStats = stats || {
    building_count: buildings.length,
    total_energy_mwh: 0,
    prediction_count: predictions.length,
    last_refresh: null,
    db_connected: true,
  };

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h2 className="admin-title">Campus Control Center</h2>
          <p className="admin-subtitle">Manage buildings, run AI predictions, and monitor live energy data</p>
        </div>
        <div className="admin-badges">
          <span className={`live-badge live-badge--${liveStatus}`}>
            {liveStatus === 'live' ? '● Live' : liveStatus === 'connecting' ? '◌ Connecting' : '○ Offline'}
          </span>
          {displayStats && !displayStats.db_connected && (
            <span className="live-badge live-badge--offline">DB disconnected</span>
          )}
        </div>
      </div>

      <div className="admin-actions">
        <button className="admin-btn admin-btn--primary" onClick={() => setShowAddForm((v) => !v)} disabled={!!loading}>
          ➕ Add Building
        </button>
        <button className="admin-btn admin-btn--ai" onClick={handleRunPrediction} disabled={!!loading}>
          {loading === 'predict' ? '⏳ Running…' : '🤖 Run AI Prediction'}
        </button>
        <button className="admin-btn admin-btn--refresh" onClick={handleRefreshEnergy} disabled={!!loading}>
          {loading === 'refresh' ? '⏳ Refreshing…' : '🔄 Refresh Energy Data'}
        </button>
        <button className="admin-btn admin-btn--export" onClick={handleExport} disabled={!!loading}>
          {loading === 'export' ? '⏳ Exporting…' : '📥 Export Report'}
        </button>
      </div>

      {showAddForm && (
        <form className="admin-form" onSubmit={handleAddBuilding}>
          <h3>New Building</h3>
          <div className="admin-form-grid">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Science Hall" required />
            </label>
            <label>
              Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option>Active</option>
                <option>Watch</option>
                <option>Stable</option>
                <option>Planned</option>
              </select>
            </label>
            <label className="admin-form-full">
              Description
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description" />
            </label>
          </div>
          <div className="admin-form-actions">
            <button type="button" className="ghost-btn" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button type="submit" className="admin-btn admin-btn--primary" disabled={loading === 'add'}>
              {loading === 'add' ? 'Saving…' : 'Save Building'}
            </button>
          </div>
        </form>
      )}

      {toast && <div className={`admin-toast admin-toast--${toast.type}`}>{toast.message}</div>}

      <div className="page-grid">
        <Card title="User count" value="1" detail="Authenticated operator" accent="Users" />
        <Card title="Building count" value={String(displayStats.building_count)} detail="Registered campus buildings" accent="Managed" />
        <Card title="Recent predictions" value={String(displayStats.prediction_count)} detail="Predictions stored in database" accent="Smart" />
        <Card title="System status" value={liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : 'Offline'} detail="Real-time monitoring" accent="Online" />
      </div>

      <div className="admin-panels">
        <section className="admin-panel">
          <h3>Buildings</h3>
          {filteredBuildings.length === 0 ? (
            <p className="admin-empty">{query ? 'No buildings match your search.' : 'No buildings yet. Click ➕ Add Building to get started.'}</p>
          ) : (
            <ul className="admin-list">
              {filteredBuildings.map((b) => (
                <li key={b.id}>
                  <strong>{b.name}</strong>
                  <span className="pill">{b.status}</span>
                  <span>{b.latest_reading ? `${(b.latest_reading / 1000).toFixed(1)} MWh` : '—'}</span>
                  <button
                    type="button"
                    className="ghost-btn admin-delete-btn"
                    onClick={() => handleDeleteBuilding(b.id, b.name)}
                    disabled={!!loading}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-panel">
          <h3>Recent Predictions</h3>
          {filteredPredictions.length === 0 ? (
            <p className="admin-empty">{query ? 'No predictions match your search.' : 'No predictions yet. Click 🤖 Run AI Prediction.'}</p>
          ) : (
            <ul className="admin-list">
              {filteredPredictions.slice(0, 8).map((p) => (
                <li key={p.id}>
                  <strong>{p.building_name}</strong>
                  <span>{p.predicted_energy.toFixed(1)} kWh</span>
                  <span className="admin-time">{formatTime(p.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {displayStats?.last_refresh && (
        <p className="admin-footer-note">Last energy refresh: {formatTime(displayStats.last_refresh)}</p>
      )}
    </div>
  );
}

export default Admin;
