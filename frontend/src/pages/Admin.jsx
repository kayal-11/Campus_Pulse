import { useCallback, useEffect, useRef, useState } from 'react';
import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';
import {
  addBuilding,
  addCustomDevice,
  addManualMeterReading,
  deleteBuilding,
  deleteCustomDevice,
  deleteUploadHistoryItem,
  exportReport,
  fetchBuildingCustomDevices,
  fetchBuildingInventory,
  fetchAdminStats,
  fetchLatestUploadReport,
  fetchUploadHistory,
  fetchUploadReport,
  refreshEnergyData,
  runAIPredictions,
  clearAllUploadHistory,
  updateBuildingInventory,
  updateCustomDevice,
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
  const [showManualMeterForm, setShowManualMeterForm] = useState(false);
  const [manualForm, setManualForm] = useState({
    building_name: '',
    custom_building_name: '',
    date: new Date().toISOString().split('T')[0],
    time: new Date().toTimeString().slice(0, 5),
    meter_reading: '',
  });
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

  const fetchAllAdminData = useCallback(async () => {
    await Promise.all([loadStats(), loadUploadData()]);
  }, [loadStats, loadUploadData]);

  useEffect(() => {
    fetchAllAdminData();
  }, [fetchAllAdminData]);


  const normalizeInventory = (values) => ({
    lights: Math.max(0, Number.parseInt(values.lights || 0, 10) || 0),
    fans: Math.max(0, Number.parseInt(values.fans || 0, 10) || 0),
    ac_units: Math.max(0, Number.parseInt(values.ac_units || 0, 10) || 0),
    computers: Math.max(0, Number.parseInt(values.computers || 0, 10) || 0),
    lab_equipment: Math.max(0, Number.parseInt(values.lab_equipment || 0, 10) || 0),
  });

  const isSupportedBuildingName = (name) => {
    if (!name) return false;
    const upper = name.trim().toUpperCase();
    return ['ADMIN', 'CHEMI', 'ECE'].some((b) => upper.includes(b));
  };

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
      await Promise.all([refresh(), fetchAllAdminData()]);
      if (!isSupportedBuildingName(buildingName)) {
        showToast('No historical data available for this building. Predictions are currently supported only for ADMIN, CHEMI, and ECE.', 'info');
      } else {
        showToast(`Building "${buildingName}" added successfully`);
      }
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
      await Promise.all([refresh(), fetchAllAdminData()]);
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
      await Promise.all([refresh(), fetchAllAdminData()]);
      showToast(`Refreshed energy data for ${result.count} building(s)`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleSaveManualMeterReading = async (e) => {
    e.preventDefault();
    const targetBuildingName = (manualForm.custom_building_name || manualForm.building_name || '').trim();
    if (!targetBuildingName) {
      showToast('Please select or enter a Building Name.', 'error');
      return;
    }
    if (!manualForm.date || !manualForm.time) {
      showToast('Please select Date and Time.', 'error');
      return;
    }
    if (manualForm.meter_reading === '' || Number(manualForm.meter_reading) < 0) {
      showToast('Meter reading (kWh) must be a non-negative number.', 'error');
      return;
    }

    setLoading('manual-meter');
    try {
      const resReading = await addManualMeterReading({
        building_name: targetBuildingName,
        date: manualForm.date,
        time: manualForm.time,
        meter_reading: parseFloat(manualForm.meter_reading),
      });
      if (!isSupportedBuildingName(targetBuildingName)) {
        showToast('No historical data available for this building. Predictions are currently supported only for ADMIN, CHEMI, and ECE.', 'info');
      } else {
        showToast(`Manual meter reading saved for ${targetBuildingName}!`);
      }
      setShowManualMeterForm(false);
      setManualForm({
        building_name: '',
        custom_building_name: '',
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().slice(0, 5),
        meter_reading: '',
      });
      await Promise.all([refresh(), fetchAllAdminData()]);

    } catch (err) {
      showToast(err.message || 'Failed to save manual meter reading.', 'error');
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
      await Promise.all([refresh(), fetchAllAdminData()]);
      showToast(`Building "${buildingName}" deleted`);

    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const [customDevices, setCustomDevices] = useState([]);
  const [newCustomDevice, setNewCustomDevice] = useState({ name: '', count: 1, wattage: 100, runtime_hours: 8 });
  const [editingCustomDevice, setEditingCustomDevice] = useState(null);

  const handleOpenInventoryEditor = async (building) => {
    setLoading(`inventory-${building.id}`);
    try {
      const [current, custom] = await Promise.all([
        fetchBuildingInventory(building.id),
        fetchBuildingCustomDevices(building.id).catch(() => []),
      ]);
      setCustomDevices(custom);
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
      setNewCustomDevice({ name: '', count: 1, wattage: 100, runtime_hours: 8 });
      setEditingCustomDevice(null);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleAddCustomDevice = async (e) => {
    e.preventDefault();
    if (!editingInventory || !newCustomDevice.name.trim()) return;
    setLoading(`add-custom-${editingInventory.buildingId}`);
    try {
      const created = await addCustomDevice(editingInventory.buildingId, {
        name: newCustomDevice.name.trim(),
        count: Math.max(0, parseInt(newCustomDevice.count, 10) || 0),
        wattage: Math.max(0, parseFloat(newCustomDevice.wattage) || 0),
        runtime_hours: Math.max(0, Math.min(24, parseFloat(newCustomDevice.runtime_hours) || 0)),
      });
      setCustomDevices((prev) => [...prev, created]);
      setNewCustomDevice({ name: '', count: 1, wattage: 100, runtime_hours: 8 });
      showToast(`Custom device "${created.name}" added to ${editingInventory.buildingName}`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleSaveCustomDeviceEdit = async (deviceId) => {
    if (!editingInventory || !editingCustomDevice) return;
    setLoading(`edit-custom-${deviceId}`);
    try {
      const updated = await updateCustomDevice(editingInventory.buildingId, deviceId, {
        name: editingCustomDevice.name.trim(),
        count: Math.max(0, parseInt(editingCustomDevice.count, 10) || 0),
        wattage: Math.max(0, parseFloat(editingCustomDevice.wattage) || 0),
        runtime_hours: Math.max(0, Math.min(24, parseFloat(editingCustomDevice.runtime_hours) || 0)),
      });
      setCustomDevices((prev) => prev.map((d) => (d.id === deviceId ? updated : d)));
      setEditingCustomDevice(null);
      showToast(`Updated "${updated.name}"`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading('');
    }
  };

  const handleDeleteCustomDevice = async (deviceId, name) => {
    if (!editingInventory) return;
    if (!window.confirm(`Delete custom device "${name}"?`)) return;
    setLoading(`delete-custom-${deviceId}`);
    try {
      await deleteCustomDevice(editingInventory.buildingId, deviceId);
      setCustomDevices((prev) => prev.filter((d) => d.id !== deviceId));
      showToast(`Deleted custom device "${name}"`);
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
      await Promise.all([refresh(), fetchAllAdminData()]);
      if (report.warning) {
        showToast(report.warning, 'info');
      } else {
        showToast(`Uploaded ${report.batch.record_count} daily reading(s) from ${file.name}`);
      }
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
      await Promise.all([refresh(), fetchAllAdminData()]);
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
      await Promise.all([refresh(), fetchAllAdminData()]);
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
        <button className="admin-btn admin-btn--primary" onClick={() => setShowManualMeterForm((v) => !v)} disabled={!!loading}>
          ⚡ Manual Meter Entry
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
          {loading === 'upload' ? '⏳ Uploading…' : '📤 Upload Meter Readings'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          onChange={handleDailyUpload}
          hidden
        />
      </div>

      {showManualMeterForm && (
        <form className="admin-form" onSubmit={handleSaveManualMeterReading}>
          <h3>Manual Meter Entry</h3>
          <p className="card-detail" style={{ marginBottom: '1rem' }}>
            Manually enter a meter reading for a building. The reading will save immediately to the database and update predictions, alerts, and charts.
          </p>
          <div className="admin-form-grid">
            <label>
              Select Building
              <select
                value={manualForm.building_name}
                onChange={(e) => setManualForm({ ...manualForm, building_name: e.target.value, custom_building_name: '' })}
              >
                <option value="">Select Existing Building...</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Or Enter Building Name
              <input
                type="text"
                placeholder="Type building name if not in list"
                value={manualForm.custom_building_name}
                onChange={(e) => setManualForm({ ...manualForm, custom_building_name: e.target.value })}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={manualForm.date}
                onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                required
              />
            </label>
            <label>
              Time
              <input
                type="time"
                value={manualForm.time}
                onChange={(e) => setManualForm({ ...manualForm, time: e.target.value })}
                required
              />
            </label>
            <label className="admin-form-full">
              Meter Reading (kWh)
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 1250.50"
                value={manualForm.meter_reading}
                onChange={(e) => setManualForm({ ...manualForm, meter_reading: e.target.value })}
                required
              />
            </label>
          </div>
          <div className="admin-form-actions">
            <button type="button" className="ghost-btn" onClick={() => setShowManualMeterForm(false)}>
              Cancel
            </button>
            <button type="submit" className="admin-btn admin-btn--primary" disabled={loading === 'manual-meter'}>
              {loading === 'manual-meter' ? 'Saving…' : '+ Save Reading'}
            </button>
          </div>
        </form>
      )}

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

              <div className="admin-custom-devices-section" style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color, #e2e8f0)' }}>
                <h4 style={{ margin: '0 0 1rem 0' }}>Other Custom Devices</h4>
                {customDevices.length > 0 ? (
                  <table className="device-table" style={{ width: '100%', marginBottom: '1rem' }}>
                    <thead>
                      <tr>
                        <th>Device Name</th>
                        <th>Count</th>
                        <th>Power (W)</th>
                        <th>Avg Hours</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customDevices.map((dev) => (
                        <tr key={dev.id}>
                          {editingCustomDevice?.id === dev.id ? (
                            <>
                              <td>
                                <input
                                  type="text"
                                  value={editingCustomDevice.name}
                                  onChange={(e) => setEditingCustomDevice({ ...editingCustomDevice, name: e.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  value={editingCustomDevice.count}
                                  onChange={(e) => setEditingCustomDevice({ ...editingCustomDevice, count: e.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  value={editingCustomDevice.wattage}
                                  onChange={(e) => setEditingCustomDevice({ ...editingCustomDevice, wattage: e.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  value={editingCustomDevice.runtime_hours}
                                  onChange={(e) => setEditingCustomDevice({ ...editingCustomDevice, runtime_hours: e.target.value })}
                                />
                              </td>
                              <td>
                                <button type="button" className="pill" onClick={() => handleSaveCustomDeviceEdit(dev.id)}>Save</button>
                                <button type="button" className="ghost-btn" onClick={() => setEditingCustomDevice(null)}>Cancel</button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td><strong>{dev.name}</strong></td>
                              <td>{dev.count}</td>
                              <td>{dev.wattage} W</td>
                              <td>{dev.runtime_hours} hrs/day</td>
                              <td>
                                <button
                                  type="button"
                                  className="ghost-btn"
                                  onClick={() => setEditingCustomDevice({ id: dev.id, name: dev.name, count: dev.count, wattage: dev.wattage, runtime_hours: dev.runtime_hours })}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="ghost-btn"
                                  style={{ color: '#ef4444' }}
                                  onClick={() => handleDeleteCustomDevice(dev.id, dev.name)}
                                >
                                  Delete
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1rem' }}>No custom devices added yet for this building.</p>
                )}

                <div className="admin-add-custom-device-box" style={{ background: 'var(--card-bg-subtle, rgba(255,255,255,0.05))', padding: '1rem', borderRadius: '8px', border: '1px var(--border-color, #e2e8f0) dashed' }}>
                  <h5 style={{ margin: '0 0 0.75rem 0' }}>Add Custom Device (e.g. Projector, Printer, Pump)</h5>
                  <div className="admin-form-grid" style={{ gap: '0.5rem' }}>
                    <label>
                      Device Title / Name
                      <input
                        type="text"
                        placeholder="e.g. Projector"
                        value={newCustomDevice.name}
                        onChange={(e) => setNewCustomDevice({ ...newCustomDevice, name: e.target.value })}
                      />
                    </label>
                    <label>
                      Count
                      <input
                        type="number"
                        min="0"
                        value={newCustomDevice.count}
                        onChange={(e) => setNewCustomDevice({ ...newCustomDevice, count: e.target.value })}
                      />
                    </label>
                    <label>
                      Power (W)
                      <input
                        type="number"
                        min="0"
                        value={newCustomDevice.wattage}
                        onChange={(e) => setNewCustomDevice({ ...newCustomDevice, wattage: e.target.value })}
                      />
                    </label>
                    <label>
                      Avg Operating Hours
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        max="24"
                        value={newCustomDevice.runtime_hours}
                        onChange={(e) => setNewCustomDevice({ ...newCustomDevice, runtime_hours: e.target.value })}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="add-custom-device-btn"
                    onClick={handleAddCustomDevice}
                    disabled={!newCustomDevice.name.trim()}
                  >
                    + Add Custom Device
                  </button>
                </div>
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
            <div className="table-wrapper">
              <table className="prediction-table">
                <thead>
                  <tr>
                    <th>Building</th>
                    <th>Forecast Date</th>
                    <th>Predicted (kWh)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPredictions.slice(0, 8).map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.building_name}</strong></td>
                      <td>{p.prediction_for_date ? new Date(p.prediction_for_date).toLocaleDateString() : formatTime(p.created_at)}</td>
                      <td><span className="pred-value" style={{ fontWeight: 600, color: 'var(--primary, #2563eb)' }}>{p.predicted_energy.toFixed(1)} kWh</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>


      </div>

      <div className="admin-panels">
        <section className="admin-panel">
          <h3>Meter Upload Summary</h3>
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
            <p className="admin-empty">
              {selectedUploadReport?.warning
                ? selectedUploadReport.warning
                : 'Upload a daily file to compare building-wise changes against the previous uploaded day.'}
            </p>
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
              {selectedUploadReport?.warning
                ? selectedUploadReport.warning
                : (selectedBatch ? 'Prediction not available for this upload.' : 'Insufficient historical data for campus forecast.')}
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
