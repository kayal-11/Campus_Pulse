import { useEffect, useMemo, useState } from 'react';
import Chart from '../components/Chart';
import { useCampusData } from '../context/CampusDataContext';
import { fetchBuildingDeviceConfig, fetchBuildingInventory, updateBuildingDeviceConfig } from '../services/api';

const DEVICE_PROFILES = [
  {
    key: 'lights',
    label: 'Lights',
    inventoryField: 'lights',
    configWattageField: 'lights_wattage',
    configHoursField: 'lights_hours',
    defaultWattage: 20,
    defaultHours: 11,
  },
  {
    key: 'fans',
    label: 'Fans',
    inventoryField: 'fans',
    configWattageField: 'fans_wattage',
    configHoursField: 'fans_hours',
    defaultWattage: 75,
    defaultHours: 10,
  },
  {
    key: 'acs',
    label: 'ACs',
    inventoryField: 'ac_units',
    configWattageField: 'acs_wattage',
    configHoursField: 'acs_hours',
    defaultWattage: 1500,
    defaultHours: 8,
  },
  {
    key: 'computers',
    label: 'Computers',
    inventoryField: 'computers',
    configWattageField: 'computers_wattage',
    configHoursField: 'computers_hours',
    defaultWattage: 140,
    defaultHours: 9,
  },
  {
    key: 'lab',
    label: 'Lab Equipment',
    inventoryField: 'lab_equipment',
    configWattageField: 'lab_wattage',
    configHoursField: 'lab_hours',
    defaultWattage: 900,
    defaultHours: 7,
  },
];

const TARIFF_PER_KWH = 0.14;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const deterministicFactor = (seed, offset = 0) => {
  const value = Math.sin(seed * 12.9898 + (offset + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

function buildDefaultDeviceInputs() {
  return DEVICE_PROFILES.reduce((acc, device) => {
    acc[device.key] = {
      wattage: device.defaultWattage,
      runtimeHours: device.defaultHours,
    };
    return acc;
  }, {});
}

function buildDefaultInventoryCounts() {
  return DEVICE_PROFILES.reduce((acc, device) => {
    acc[device.key] = 0;
    return acc;
  }, {});
}

function buildDeviceInputsFromConfig(config) {
  return DEVICE_PROFILES.reduce((acc, device) => {
    acc[device.key] = {
      wattage: sanitizeNumber(config?.[device.configWattageField], device.defaultWattage),
      runtimeHours: sanitizeNumber(config?.[device.configHoursField], device.defaultHours),
    };
    return acc;
  }, {});
}

function buildConfigPayloadFromInputs(inputs) {
  return DEVICE_PROFILES.reduce((acc, device) => {
    const current = inputs[device.key] || {};
    acc[device.configWattageField] = sanitizeNumber(current.wattage, device.defaultWattage);
    acc[device.configHoursField] = sanitizeNumber(current.runtimeHours, device.defaultHours);
    return acc;
  }, {});
}

function sanitizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function buildEstimatedDeviceModel(building, deviceInputs, latestBuildingEnergyKwh, inventoryCounts) {
  const seedBase = Number(building.id) || building.name.length || 1;
  const statusFactor =
    String(building.status).toLowerCase() === 'watch'
      ? 0.08
      : String(building.status).toLowerCase() === 'stable'
        ? -0.05
        : 0.03;
  const occupancy = clamp(0.44 + deterministicFactor(seedBase, 1) * 0.42 + statusFactor, 0.3, 0.95);

  const rowsWithDailyEnergy = DEVICE_PROFILES.map((device) => {
    const configured = deviceInputs[device.key] || {};
    const count = sanitizeNumber(inventoryCounts[device.key], 0);
    const wattage = sanitizeNumber(configured.wattage, device.defaultWattage);
    const runtimeHours = sanitizeNumber(configured.runtimeHours, device.defaultHours);
    const estimatedKwh = (count * wattage * runtimeHours) / 1000;
    return {
      key: device.key,
      category: device.label,
      count,
      wattage,
      runtimeHours,
      estimatedKwh,
      estimatedSavingsPerHourKwh: (count * wattage) / 1000,
    };
  });

  const totalEstimatedKwh = rowsWithDailyEnergy.reduce((sum, row) => sum + row.estimatedKwh, 0);
  const referenceTotalKwh = Math.max(0, Number(latestBuildingEnergyKwh) || 0);
  const scalingFactor = totalEstimatedKwh > 0 && referenceTotalKwh > 0 ? referenceTotalKwh / totalEstimatedKwh : 0;

  const rows = rowsWithDailyEnergy.map((row) => ({
    ...row,
    normalizedKwh: row.estimatedKwh * scalingFactor,
    percentage: referenceTotalKwh > 0 ? ((row.estimatedKwh * scalingFactor) / referenceTotalKwh) * 100 : 0,
    monthlyCost: row.estimatedKwh * scalingFactor * 30 * TARIFF_PER_KWH,
  }));

  const sortedByUse = [...rows].sort((a, b) => b.normalizedKwh - a.normalizedKwh);
  const top = sortedByUse[0];
  const second = sortedByUse[1];
  const lights = rows.find((row) => row.key === 'lights');

  const aiInsights = [
    top
      ? `${top.category} contribute ${top.percentage.toFixed(1)}% of the estimated device energy.`
      : 'Insufficient data for contributor analysis.',
    `Latest historical building energy is ${referenceTotalKwh.toFixed(1)} kWh/day; device estimates are normalized to match.`,
    second
      ? `${second.category} are the second-largest load at ${second.normalizedKwh.toFixed(1)} kWh/day.`
      : 'Secondary load insight is unavailable.',
  ];

  const recommendations = [
    top
      ? `Reduce ${top.category} operating hours by 1 hour to save about ${top.estimatedSavingsPerHourKwh.toFixed(1)} kWh/day (${(top.estimatedSavingsPerHourKwh * TARIFF_PER_KWH * 30).toFixed(0)} USD/month).`
      : 'Collect a full day of meter data to generate recommendations.',
    second
      ? `Shift 10% of ${second.category} operation away from peak periods to reduce cooling and demand overlap.`
      : 'Add a second major load profile to improve recommendations.',
    lights
      ? `Apply occupancy-driven lighting schedules to trim up to ${(lights.normalizedKwh * 0.12).toFixed(1)} kWh/day from lighting consumption.`
      : 'Lighting control recommendation unavailable.',
  ];

  return {
    occupancy,
    rows,
    totalKwh: referenceTotalKwh,
    rawEstimatedTotalKwh: totalEstimatedKwh,
    scalingFactor,
    tariffPerKwh: TARIFF_PER_KWH,
    aiInsights,
    recommendations,
  };
}

function Buildings() {
  const { buildings } = useCampusData();
  const [selectedBuildingId, setSelectedBuildingId] = useState(null);
  const [deviceInputsByBuilding, setDeviceInputsByBuilding] = useState({});
  const [inventoryByBuilding, setInventoryByBuilding] = useState({});
  const [configLoadingByBuilding, setConfigLoadingByBuilding] = useState({});
  const [saveState, setSaveState] = useState({ status: '', message: '' });

  const selectedBuilding = useMemo(() => {
    if (!buildings.length) return null;
    const targetId = selectedBuildingId ?? buildings[0]?.id;
    return buildings.find((building) => building.id === targetId) || buildings[0];
  }, [buildings, selectedBuildingId]);

  const selectedDeviceInputs = useMemo(() => {
    if (!selectedBuilding) return null;
    return deviceInputsByBuilding[selectedBuilding.id] || buildDefaultDeviceInputs();
  }, [deviceInputsByBuilding, selectedBuilding]);

  useEffect(() => {
    if (!selectedBuilding?.id) return undefined;

    let cancelled = false;

    const loadDeviceConfig = async () => {
      setConfigLoadingByBuilding((prev) => ({ ...prev, [selectedBuilding.id]: true }));
      try {
        const config = await fetchBuildingDeviceConfig(selectedBuilding.id);
        if (cancelled) return;
        setDeviceInputsByBuilding((prev) => ({
          ...prev,
          [selectedBuilding.id]: buildDeviceInputsFromConfig(config),
        }));
      } catch {
        if (cancelled) return;
        setDeviceInputsByBuilding((prev) => ({
          ...prev,
          [selectedBuilding.id]: buildDefaultDeviceInputs(),
        }));
      } finally {
        if (cancelled) return;
        setConfigLoadingByBuilding((prev) => ({ ...prev, [selectedBuilding.id]: false }));
      }
    };

    loadDeviceConfig();
    setSaveState({ status: '', message: '' });

    return () => {
      cancelled = true;
    };
  }, [selectedBuilding?.id]);

  useEffect(() => {
    if (!selectedBuilding?.id) return undefined;

    let cancelled = false;

    const loadInventory = async () => {
      try {
        const inventory = await fetchBuildingInventory(selectedBuilding.id);
        if (cancelled) return;

        setInventoryByBuilding((prev) => ({
          ...prev,
          [selectedBuilding.id]: {
            lights: sanitizeNumber(inventory?.lights, 0),
            fans: sanitizeNumber(inventory?.fans, 0),
            acs: sanitizeNumber(inventory?.ac_units, 0),
            computers: sanitizeNumber(inventory?.computers, 0),
            lab: sanitizeNumber(inventory?.lab_equipment, 0),
          },
        }));
      } catch {
        if (cancelled) return;
        setInventoryByBuilding((prev) => ({
          ...prev,
          [selectedBuilding.id]: buildDefaultInventoryCounts(),
        }));
      }
    };

    loadInventory();
    const interval = setInterval(loadInventory, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedBuilding?.id]);

  const selectedInventoryCounts = useMemo(() => {
    if (!selectedBuilding) return null;
    return inventoryByBuilding[selectedBuilding.id] || buildDefaultInventoryCounts();
  }, [inventoryByBuilding, selectedBuilding]);

  const latestHistoricalEnergyKwh = useMemo(() => {
    if (!selectedBuilding) return 0;
    return Math.max(0, Number(selectedBuilding.latest_reading) || 0);
  }, [selectedBuilding]);

  const deviceModel = useMemo(() => {
    if (!selectedBuilding || !selectedDeviceInputs || !selectedInventoryCounts) return null;
    return buildEstimatedDeviceModel(selectedBuilding, selectedDeviceInputs, latestHistoricalEnergyKwh, selectedInventoryCounts);
  }, [selectedBuilding, selectedDeviceInputs, latestHistoricalEnergyKwh, selectedInventoryCounts]);

  if (!buildings.length) {
    return (
      <div className="page-empty">
        <p>No buildings found. Add one from the Admin panel.</p>
      </div>
    );
  }

  if (!selectedBuilding || !deviceModel) {
    return null;
  }

  const chartData = deviceModel.rows.map((row) => ({
    label: row.category,
    value: Number(row.percentage.toFixed(2)),
  }));

  const topDevice = [...deviceModel.rows].sort((a, b) => b.normalizedKwh - a.normalizedKwh)[0];

  const updateDeviceInput = (deviceKey, field, rawValue) => {
    setSaveState({ status: '', message: '' });
    const value = rawValue === '' ? 0 : sanitizeNumber(rawValue, 0);
    setDeviceInputsByBuilding((prev) => {
      const buildingId = selectedBuilding.id;
      const currentBuildingInputs = prev[buildingId] || buildDefaultDeviceInputs();
      const currentDevice = currentBuildingInputs[deviceKey] || {};

      return {
        ...prev,
        [buildingId]: {
          ...currentBuildingInputs,
          [deviceKey]: {
            ...currentDevice,
            [field]: value,
          },
        },
      };
    });
  };

  const handleSaveDeviceConfiguration = async () => {
    if (!selectedBuilding) return;
    const payload = buildConfigPayloadFromInputs(selectedDeviceInputs || buildDefaultDeviceInputs());

    setSaveState({ status: 'saving', message: '' });
    try {
      const saved = await updateBuildingDeviceConfig(selectedBuilding.id, payload);
      setDeviceInputsByBuilding((prev) => ({
        ...prev,
        [selectedBuilding.id]: buildDeviceInputsFromConfig(saved),
      }));
      setSaveState({ status: 'success', message: 'Device configuration saved successfully.' });
    } catch (error) {
      setSaveState({ status: 'error', message: error.message || 'Failed to save device configuration.' });
    }
  };

  const isConfigLoading = Boolean(configLoadingByBuilding[selectedBuilding.id]);

  return (
    <div className="buildings-page">
      <section className="building-directory card">
        <div className="building-directory__header">
          <p className="card-title">Buildings</p>
          <h3>Asset Directory</h3>
        </div>
        <div className="building-directory__list">
          {buildings.map((building) => {
            const isActive = building.id === selectedBuilding.id;
            return (
              <button
                key={building.id}
                type="button"
                className={`building-directory__item${isActive ? ' active' : ''}`}
                onClick={() => setSelectedBuildingId(building.id)}
              >
                <div>
                  <strong>{building.name}</strong>
                  <p>{building.description || 'No description available'}</p>
                </div>
                <span className="pill">{building.status || 'Active'}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="building-detail">
        <section className="card building-detail__hero">
          <div>
            <p className="card-title">Building Detail</p>
            <h3>{selectedBuilding.name}</h3>
            <p className="card-detail">{selectedBuilding.description || 'Energy profile based on total building meter reading.'}</p>
          </div>
          <div className="building-detail__hero-metrics">
            <div>
              <span>Total Building Energy</span>
              <strong>{deviceModel.totalKwh.toFixed(1)} kWh/day</strong>
            </div>
            <div>
              <span>Modeled Occupancy</span>
              <strong>{Math.round(deviceModel.occupancy * 100)}%</strong>
            </div>
            <div>
              <span>Top Contributor</span>
              <strong>{topDevice ? topDevice.category : 'N/A'}</strong>
            </div>
            <div>
              <span>Tariff Model</span>
              <strong>{deviceModel.tariffPerKwh.toFixed(2)} USD/kWh</strong>
            </div>
          </div>
        </section>

        <section className="card device-section">
          <div className="card-header">
            <div>
              <p className="card-title">Device Section</p>
              <h3>Estimated Device-wise Energy Breakdown</h3>
              <p className="card-detail">
                Count is synced from Building Inventory. Edit power and average hours, then save this configuration for the building.
              </p>
            </div>
            <div>
              <button
                type="button"
                className="pill"
                onClick={handleSaveDeviceConfiguration}
                disabled={isConfigLoading || saveState.status === 'saving'}
              >
                {saveState.status === 'saving' ? 'Saving...' : 'Save Device Configuration'}
              </button>
            </div>
          </div>
          {isConfigLoading && <p className="card-detail">Loading saved device configuration...</p>}
          {saveState.message && <p className="card-detail">{saveState.message}</p>}

          <div className="device-section__layout">
            <div className="device-table-wrapper">
              <table className="device-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Count</th>
                    <th>Power (W)</th>
                    <th>Avg Hours</th>
                    <th>Estimated kWh/day</th>
                    <th>Share (%)</th>
                    <th>Monthly Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceModel.rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.category}</td>
                      <td>{Math.round(row.count)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={selectedDeviceInputs[row.key]?.wattage ?? 0}
                          onChange={(event) => updateDeviceInput(row.key, 'wattage', event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={selectedDeviceInputs[row.key]?.runtimeHours ?? 0}
                          onChange={(event) => updateDeviceInput(row.key, 'runtimeHours', event.target.value)}
                        />
                      </td>
                      <td>{row.normalizedKwh.toFixed(1)}</td>
                      <td>{row.percentage.toFixed(1)}%</td>
                      <td>{row.monthlyCost.toFixed(0)} USD</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="device-chart-wrapper">
              <Chart
                title="Device Energy Mix"
                subtitle="Share (%) derived from estimated device-wise kWh/day"
                accent="Visual"
                type="pie"
                data={chartData}
                emptyText="No estimated device data"
              />
            </div>
          </div>

          <div className="device-insights-grid">
            <section className="device-panel">
              <h4>Estimation Insights</h4>
              <ul>
                {deviceModel.aiInsights.map((insight) => (
                  <li key={insight}>{insight}</li>
                ))}
              </ul>
            </section>
            <section className="device-panel">
              <h4>Recommended Actions</h4>
              <ul>
                {deviceModel.recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>

          <section className="device-wireframe">
            <h4>Wireframe</h4>
            <pre>{`+--------------------------------------------------------------+
| Building Header: Name | Total kWh/day | Occupancy | Tariff |
--------------------------------------------------------------+
| Device Inventory Table                      | Donut/Pie Chart |
| Device | Count | W | Hours | kWh | %                        |
| Monthly Cost per Category                                |   |
+--------------------------------------------------------------+
| Estimation Insights                  | Recommended Actions   |
+--------------------------------------------------------------+`}</pre>
          </section>
        </section>
      </section>
    </div>
  );
}

export default Buildings;
