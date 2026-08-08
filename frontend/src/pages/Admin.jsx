import { useCallback, useEffect, useRef, useState } from 'react';
import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';
import {
  addBuilding,
  deleteBuilding,
  deleteUploadHistoryItem,
  exportReport,
  fetchBuildingInventory,
  fetchAdminStats,
  fetchLatestUploadReport,
  fetchUploadHistory,
  fetchUploadReport,
  refreshEnergyData,
  runAIPredictions,
  clearAllUploadHistory,
  updateBuildingInventory,
  uploadDailyMeterReadings,
} from '../services/api';

const EMPTY_INVENTORY = {
  lights: '',
  fans: '',
  ac_units: '',
  computers: '',
  lab_equipment: '',
};

function Admin({ searchQuery = '' }) {
  const { buildings, predictions, liveStatus, refresh } = useCampusData();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState('');
  const [toast, setToast] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', status: 'Active', initial_date: '', initial_time: '', initial_meter_reading: '' });
  const [inventoryForm, setInventoryForm] = useState(EMPTY_INVENTORY);
  const [editingInventory, setEditingInventory] = useState(null);
  const [uploadHistory, setUploadHistory] = useState([]);
  const [latestUploadReport, setLatestUploadReport] = useState(null);
  const [selectedUploadReport, setSelectedUploadReport] = useState(null);
  const fileInputRef = useRef(null);

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

  const loadUploadData = useCallback(async () => {
    try {
      const [history, latest] = await Promise.all([fetchUploadHistory(), fetchLatestUploadReport()]);
      setUploadHistory(history);
      setLatestUploadReport(latest);
      setSelectedUploadReport((current) => {
        if (!current) return latest;
        const updated = history.find((item) => item.id === current.batch.id);
        return updated ? current : latest;
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }, [showToast]);

  useEffect(() => {
    loadUploadData();
  }, [loadUploadData]);

  const normalizeInventory = (values) => ({
    lights: Math.max(0, Number.parseInt(values.lights || 0, 10) || 0),
    fans: Math.max(0, Number.parseInt(values.fans || 0, 10) || 0),
    ac_units: Math.max(0, Number.parseInt(values.ac_units || 0, 10) || 0),
    computers: Math.max(0, Number.parseInt(values.computers || 0, 10) || 0),
    lab_equipment: Math.max(0, Number.parseInt(values.lab_equipment || 0, 10) || 0),
  });

  const handleAddBuilding = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const buildingName = form.name.trim();
    setLoading('add');
    try {
      await addBuilding({
        ...form,
        name: buildingName,
        initial_meter_reading: Number(form.initial_meter_reading),
        inventory: normalizeInventory(inventoryForm),
      });
      setForm({ name: '', description: '', status: 'Active', initial_date: '', initial_time: '', initial_meter_reading: '' });
      setInventoryForm(EMPTY_INVENTORY);
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
    const confirmed = window.confirm(`Delete building "${buildingName}"? This will remove only this building and its related data.`);
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

  const handleOpenInventoryEditor = async (building) => {
    setLoading(`inventory-${building.id}`);
    try {
      const current = await fetchBuildingInventory(building.id);
      setEditingInventory({
        buildingId: building.id,
        buildingName: building.name,
        values: {
          lights: String(current.lights ?? 0),
          fans: String(current.fans ?? 0),
          ac_units: String(current.ac_units ?? 0),
          computers: String(current.computers ?? 0),
          lab_equipment: String(current.lab_equipment ?? 0),
        },
      });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleSaveInventory = async (event) => {
    event.preventDefault();
    if (!editingInventory) return;

    setLoading(`save-inventory-${editingInventory.buildingId}`);
    try {
      await updateBuildingInventory(editingInventory.buildingId, normalizeInventory(editingInventory.values));
      showToast(`Inventory updated for ${editingInventory.buildingName}`);
      setEditingInventory(null);
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

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDailyUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx'].includes(extension || '')) {
      showToast('Upload a CSV or XLSX file', 'error');
      return;
    }

    setLoading('upload');
    try {
      const report = await uploadDailyMeterReadings(file);
      setLatestUploadReport(report);
      setSelectedUploadReport(report);
      await Promise.all([refresh(), loadStats(), loadUploadData()]);
      showToast(`Uploaded ${report.batch.record_count} daily reading(s) from ${file.name}`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleOpenUploadReport = async (batchId) => {
    setLoading(`history-${batchId}`);
    try {
      setSelectedUploadReport(await fetchUploadReport(batchId));
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleDeleteUploadHistoryItem = async (item) => {
    const confirmed = window.confirm(`Delete upload "${item.source_filename}" from ${new Date(item.batch_date).toLocaleDateString()}?`);
    if (!confirmed) return;

    setLoading(`delete-history-${item.id}`);
    try {
      await deleteUploadHistoryItem(item.id);
      await Promise.all([refresh(), loadStats(), loadUploadData()]);
      showToast(`Deleted upload "${item.source_filename}"`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleClearAllHistory = async () => {
    const confirmed = window.confirm('Clear all campus upload history, comparisons, and prediction history? This cannot be undone.');
    if (!confirmed) return;

    setLoading('clear-history');
    try {
      const result = await clearAllUploadHistory();
      await Promise.all([refresh(), loadStats(), loadUploadData()]);
      showToast(result?.message || 'No campus upload history found. Forecasts will use stored campus meter history.');
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

  const latestBatch = latestUploadReport?.batch;
  const selectedBatch = selectedUploadReport?.batch;
  const selectedComparisons = selectedUploadReport?.comparisons || [];
  const adminFutureForecasts = selectedUploadReport?.forecasts || [];

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
        <button className="admin-btn admin-btn--primary" onClick={handleUploadClick} disabled={!!loading}>
          {loading === 'upload' ? '⏳ Uploading…' : '📤 Upload Daily Meter Readings'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          onChange={handleDailyUpload}
          hidden
        />
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
            <label>
              Date
              <input
                type="date"
                value={form.initial_date}
                onChange={(e) => setForm({ ...form, initial_date: e.target.value })}
                required
              />
            </label>
            <label>
              Time
              <input
                type="time"
                value={form.initial_time}
                onChange={(e) => setForm({ ...form, initial_time: e.target.value })}
                required
              />
            </label>
            <label className="admin-form-full">
              Initial Meter Reading (kWh)
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.initial_meter_reading}
                onChange={(e) => setForm({ ...form, initial_meter_reading: e.target.value })}
                placeholder="0"
                required
              />
            </label>
            <div className="admin-form-full">
              <h3>Building Inventory</h3>
            </div>
            <label>
              Number of Lights
              <input
                type="number"
                min="0"
                step="1"
                value={inventoryForm.lights}
                onChange={(e) => setInventoryForm({ ...inventoryForm, lights: e.target.value })}
                placeholder="0"
              />
            </label>
            <label>
              Number of Fans
              <input
                type="number"
                min="0"
                step="1"
                value={inventoryForm.fans}
                onChange={(e) => setInventoryForm({ ...inventoryForm, fans: e.target.value })}
                placeholder="0"
              />
            </label>
            <label>
              Number of AC Units
              <input
                type="number"
                min="0"
                step="1"
                value={inventoryForm.ac_units}
                onChange={(e) => setInventoryForm({ ...inventoryForm, ac_units: e.target.value })}
                placeholder="0"
              />
            </label>
            <label>
              Number of Computers
              <input
                type="number"
                min="0"
                step="1"
                value={inventoryForm.computers}
                onChange={(e) => setInventoryForm({ ...inventoryForm, computers: e.target.value })}
                placeholder="0"
              />
            </label>
            <label className="admin-form-full">
              Number of Lab Equipment
              <input
                type="number"
                min="0"
                step="1"
                value={inventoryForm.lab_equipment}
                onChange={(e) => setInventoryForm({ ...inventoryForm, lab_equipment: e.target.value })}
                placeholder="0"
              />
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
                    className="ghost-btn"
                    onClick={() => handleOpenInventoryEditor(b)}
                    disabled={!!loading}
                  >
                    {loading === `inventory-${b.id}` ? 'Loading…' : 'Edit Inventory'}
                  </button>
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
          {editingInventory && (
            <form className="admin-form" onSubmit={handleSaveInventory}>
              <h3>Edit Inventory - {editingInventory.buildingName}</h3>
              <div className="admin-form-grid">
                <label>
                  Number of Lights
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editingInventory.values.lights}
                    onChange={(e) =>
                      setEditingInventory({
                        ...editingInventory,
                        values: { ...editingInventory.values, lights: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Number of Fans
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editingInventory.values.fans}
                    onChange={(e) =>
                      setEditingInventory({
                        ...editingInventory,
                        values: { ...editingInventory.values, fans: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Number of AC Units
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editingInventory.values.ac_units}
                    onChange={(e) =>
                      setEditingInventory({
                        ...editingInventory,
                        values: { ...editingInventory.values, ac_units: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Number of Computers
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editingInventory.values.computers}
                    onChange={(e) =>
                      setEditingInventory({
                        ...editingInventory,
                        values: { ...editingInventory.values, computers: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="admin-form-full">
                  Number of Lab Equipment
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editingInventory.values.lab_equipment}
                    onChange={(e) =>
                      setEditingInventory({
                        ...editingInventory,
                        values: { ...editingInventory.values, lab_equipment: e.target.value },
                      })
                    }
                  />
                </label>
              </div>
              <div className="admin-form-actions">
                <button type="button" className="ghost-btn" onClick={() => setEditingInventory(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn admin-btn--primary"
                  disabled={loading === `save-inventory-${editingInventory.buildingId}`}
                >
                  {loading === `save-inventory-${editingInventory.buildingId}` ? 'Saving…' : 'Save Inventory'}
                </button>
              </div>
            </form>
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

      <div className="admin-panels">
        <section className="admin-panel">
          <h3>Daily Upload Summary</h3>
          {!latestBatch ? (
            <p className="admin-empty">No campus upload history found. Forecasts will use stored campus meter history.</p>
          ) : (
            <div className="admin-upload-summary">
              <div className="admin-upload-grid">
                <div>
                  <span className="admin-kicker">Latest file</span>
                  <strong>{latestBatch.source_filename}</strong>
                </div>
                <div>
                  <span className="admin-kicker">Upload date</span>
                  <strong>{formatTime(latestBatch.batch_date)}</strong>
                </div>
                <div>
                  <span className="admin-kicker">Records stored</span>
                  <strong>{latestBatch.record_count}</strong>
                </div>
                <div>
                  <span className="admin-kicker">Total consumption</span>
                  <strong>{latestBatch.total_kwh.toFixed(1)} kWh</strong>
                </div>
              </div>
              <p className="admin-upload-meta">
                {latestBatch.comparison_ready
                  ? `Compared with previous upload: ${latestBatch.percentage_change?.toFixed(2) ?? '0.00'}% change, ${latestBatch.high_consumption_count} high-consumption building(s).`
                  : 'First upload detected. Predictions continue to use the existing campus Random Forest model while storing campus history for future comparison.'}
              </p>
            </div>
          )}
        </section>

        <section className="admin-panel">
          <h3>Upload History</h3>
          <div className="admin-form-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={handleClearAllHistory}
              disabled={!!loading || uploadHistory.length === 0}
            >
              {loading === 'clear-history' ? 'Clearing…' : 'Clear All History'}
            </button>
          </div>
          {uploadHistory.length === 0 ? (
            <p className="admin-empty">No historical uploads available yet.</p>
          ) : (
            <ul className="admin-list">
              {uploadHistory.map((item) => (
                <li key={item.id}>
                  <strong>{item.source_filename}</strong>
                  <span>{new Date(item.batch_date).toLocaleDateString()}</span>
                  <span>{item.total_kwh.toFixed(1)} kWh</span>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => handleOpenUploadReport(item.id)}
                    disabled={!!loading}
                  >
                    {loading === `history-${item.id}` ? 'Loading…' : 'View'}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn admin-delete-btn"
                    onClick={() => handleDeleteUploadHistoryItem(item)}
                    disabled={!!loading}
                  >
                    {loading === `delete-history-${item.id}` ? 'Deleting…' : 'Delete'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="admin-panels">
        <section className="admin-panel">
          <h3>{selectedBatch ? `Daily Comparison - ${new Date(selectedBatch.batch_date).toLocaleDateString()}` : 'Daily Comparison'}</h3>
          {selectedComparisons.length === 0 ? (
            <p className="admin-empty">Upload a daily file to compare building-wise changes against the previous uploaded day.</p>
          ) : (
            <ul className="admin-list">
              {selectedComparisons.slice(0, 8).map((item) => (
                <li key={`${item.building_name}-${item.today_kwh}`}>
                  <strong>{item.building_name}</strong>
                  <span>{item.today_kwh.toFixed(1)} kWh</span>
                  <span>
                    {item.direction === 'increase' ? '+' : item.direction === 'decrease' ? '' : '±'}
                    {item.change_kwh.toFixed(1)} kWh
                  </span>
                  <span className={item.high_consumption ? 'admin-chip admin-chip--high' : 'admin-chip'}>
                    {item.percentage_change === null ? 'Baseline' : `${item.percentage_change.toFixed(1)}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-panel">
          <h3>{selectedBatch ? 'Tomorrow Forecast' : 'Forecast Preview'}</h3>
          {adminFutureForecasts.length === 0 ? (
            <p className="admin-empty">
              {selectedBatch ? 'Prediction not available for this upload.' : 'Insufficient historical data for campus forecast.'}
            </p>
          ) : (
            <ul className="admin-list">
              {adminFutureForecasts.slice(0, 8).map((item) => (
                <li key={`${item.building_name}-${item.predicted_energy}`}>
                  <strong>{item.building_name}</strong>
                  <span>{item.predicted_energy.toFixed(1)} kWh</span>
                  <span className={`admin-chip admin-chip--${item.risk_level.toLowerCase()}`}>{item.risk_level}</span>
                  <span>{item.model_source}</span>
                </li>
              ))}
            </ul>
          )}
          {adminFutureForecasts.length > 0 && (
            <p className="admin-upload-meta">Top recommendation: {adminFutureForecasts[0].recommendation}</p>
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
