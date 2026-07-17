import { useCallback, useEffect, useRef, useState } from 'react';
import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';
import {
  addBuilding,
  deleteBuilding,
  deleteUploadHistoryItem,
  exportReport,
  fetchAdminStats,
  fetchLatestUploadReport,
  fetchUploadHistory,
  fetchUploadReport,
  refreshEnergyData,
  runAIPredictions,
  clearAllUploadHistory,
  uploadDailyMeterReadings,
} from '../services/api';

function Admin({ searchQuery = '' }) {
  const { buildings, predictions, liveStatus, refresh } = useCampusData();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState('');
  const [toast, setToast] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showManualEntryForm, setShowManualEntryForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', status: 'Active' });
  const [manualEntry, setManualEntry] = useState(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mmDate = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const isoDate = `${yyyy}-${mmDate}-${dd}`;
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return {
      buildingName: '',
      date: isoDate,
      time: `${hh}:${mm}`,
      meterReading: '',
    };
  });
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

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleManualEntrySubmit = async (event) => {
    event.preventDefault();

    const buildingName = manualEntry.buildingName.trim();
    const date = manualEntry.date;
    const time = manualEntry.time;
    const meterReading = Number(manualEntry.meterReading);

    if (!buildingName || !date || !time || Number.isNaN(meterReading) || meterReading < 0) {
      showToast('Provide valid building name, date, time, and non-negative meter reading', 'error');
      return;
    }

    const csvContent = [
      'Building Name,Date,Time,Meter Reading',
      `"${buildingName.replace(/"/g, '""')}",${date},${time},${meterReading}`,
    ].join('\n');

    const fileName = `manual-entry-${date}.csv`;
    const file = new File([csvContent], fileName, { type: 'text/csv' });

    setLoading('manual-entry');
    try {
      const report = await uploadDailyMeterReadings(file);
      setLatestUploadReport(report);
      setSelectedUploadReport(report);
      await Promise.all([refresh(), loadStats(), loadUploadData()]);
      showToast(`Manual entry saved for ${buildingName} (${meterReading.toFixed(2)} kWh)`);
      setShowManualEntryForm(false);
      setManualEntry((prev) => ({ ...prev, buildingName: '', meterReading: '' }));
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
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
      showToast(result?.message || 'No campus upload history found. Using ASHRAE prediction model.');
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
  const selectedForecasts = selectedUploadReport?.forecasts || [];
  const comparisonByBuilding = new Map(
    selectedComparisons.map((item) => [item.building_name.toLowerCase(), item]),
  );
  const adminFutureForecasts = selectedForecasts.map((item) => {
    const comparison = comparisonByBuilding.get((item.building_name || '').toLowerCase());
    if (!comparison) {
      return item;
    }
    const today = Number(comparison.today_kwh) || 0;
    const yesterday = Number(comparison.yesterday_kwh) || 0;
    const difference = today - yesterday;
    const predicted = Math.max(today + (difference * 0.5), 0);
    return {
      ...item,
      predicted_energy: predicted,
    };
  });

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
        <button className="admin-btn admin-btn--primary" onClick={() => setShowManualEntryForm((v) => !v)} disabled={!!loading}>
          {showManualEntryForm ? '✖ Close Manual Entry' : '✍️ Manual Meter Entry'}
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
          </div>
          <div className="admin-form-actions">
            <button type="button" className="ghost-btn" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button type="submit" className="admin-btn admin-btn--primary" disabled={loading === 'add'}>
              {loading === 'add' ? 'Saving…' : 'Save Building'}
            </button>
          </div>
        </form>
      )}

      {showManualEntryForm && (
        <form className="admin-form" onSubmit={handleManualEntrySubmit}>
          <h3>Manual Meter Entry</h3>
          <div className="admin-form-grid">
            <label>
              Building Name
              <input
                value={manualEntry.buildingName}
                onChange={(e) => setManualEntry({ ...manualEntry, buildingName: e.target.value })}
                placeholder="e.g. Admin Block"
                required
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={manualEntry.date}
                onChange={(e) => setManualEntry({ ...manualEntry, date: e.target.value })}
                required
              />
            </label>
            <label>
              Time
              <input
                type="time"
                value={manualEntry.time}
                onChange={(e) => setManualEntry({ ...manualEntry, time: e.target.value })}
                required
              />
            </label>
            <label>
              Meter Reading
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualEntry.meterReading}
                onChange={(e) => setManualEntry({ ...manualEntry, meterReading: e.target.value })}
                placeholder="kWh"
                required
              />
            </label>
          </div>
          <div className="admin-form-actions">
            <button type="button" className="ghost-btn" onClick={() => setShowManualEntryForm(false)}>Cancel</button>
            <button type="submit" className="admin-btn admin-btn--primary" disabled={loading === 'manual-entry'}>
              {loading === 'manual-entry' ? 'Saving…' : 'Save Entry'}
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

      <div className="admin-panels">
        <section className="admin-panel">
          <h3>Daily Upload Summary</h3>
          {!latestBatch ? (
            <p className="admin-empty">No campus upload history found. Using ASHRAE prediction model.</p>
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
                  : 'First upload detected. Predictions continue to use the existing ASHRAE Random Forest baseline while storing campus history for future comparison.'}
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
            <p className="admin-empty">Tomorrow predictions will appear here after a daily upload is processed.</p>
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
