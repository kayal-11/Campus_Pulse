import { useMemo, useState } from 'react';
import Chart from '../components/Chart';
import { useCampusData } from '../context/CampusDataContext';

const DEVICE_PROFILES = [
  { key: 'lights', label: 'Lights', baseCount: 210, wattage: 20, baseHours: 11, baseDemand: 0.74, onBias: 0.9, scheduleFactor: 1 },
  { key: 'fans', label: 'Fans', baseCount: 120, wattage: 75, baseHours: 10, baseDemand: 0.68, onBias: 0.82, scheduleFactor: 0.96 },
  { key: 'acs', label: 'ACs', baseCount: 68, wattage: 1500, baseHours: 8, baseDemand: 0.81, onBias: 0.88, scheduleFactor: 1.02 },
  { key: 'computers', label: 'Computers', baseCount: 160, wattage: 140, baseHours: 9, baseDemand: 0.58, onBias: 0.7, scheduleFactor: 0.92 },
  { key: 'lab', label: 'Lab Equipment', baseCount: 38, wattage: 900, baseHours: 7, baseDemand: 0.51, onBias: 0.52, scheduleFactor: 0.86 },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const deterministicFactor = (seed, offset = 0) => {
  const value = Math.sin(seed * 12.9898 + (offset + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

function estimateDevicesForBuilding(building) {
  const totalKwh = Number(building.latest_reading) > 0 ? Number(building.latest_reading) : 0;
  const seedBase = Number(building.id) || building.name.length || 1;
  const statusFactor =
    String(building.status).toLowerCase() === 'watch'
      ? 0.08
      : String(building.status).toLowerCase() === 'stable'
        ? -0.05
        : 0.03;
  const occupancy = clamp(0.44 + deterministicFactor(seedBase, 1) * 0.42 + statusFactor, 0.3, 0.95);
  const tariffPerKwh = 0.14;

  const rawRows = DEVICE_PROFILES.map((device, index) => {
    const variability = 0.76 + deterministicFactor(seedBase, index + 3) * 0.52;
    const count = Math.max(1, Math.round(device.baseCount * variability));
    const runtimeHours = device.baseHours * (0.68 + occupancy * 0.58) * device.scheduleFactor;
    const demandFactor = clamp(device.baseDemand * (0.72 + occupancy * 0.5), 0.22, 0.98);
    const rawKwh = (count * device.wattage * runtimeHours * demandFactor) / 1000;
    const onProbability = clamp(device.onBias * occupancy + deterministicFactor(seedBase, index + 11) * 0.2, 0.08, 0.99);
    const isOn = onProbability >= 0.5;

    const healthIndex =
      100
      - onProbability * 28
      - deterministicFactor(seedBase, index + 21) * 20
      - (String(building.status).toLowerCase() === 'watch' ? 8 : 0);

    let healthLabel = 'Healthy';
    let healthClass = 'device-health--healthy';
    if (healthIndex < 68) {
      healthLabel = 'Needs Service';
      healthClass = 'device-health--critical';
    } else if (healthIndex < 82) {
      healthLabel = 'Monitor';
      healthClass = 'device-health--warning';
    }

    return {
      key: device.key,
      category: device.label,
      count,
      wattage: device.wattage,
      runtimeHours,
      demandFactor,
      rawKwh,
      status: isOn ? 'ON' : 'OFF',
      healthLabel,
      healthClass,
      estimatedSavingsPerHourKwh: ((count * device.wattage * demandFactor) / 1000),
    };
  });

  const rawTotal = rawRows.reduce((sum, row) => sum + row.rawKwh, 0);
  const scale = totalKwh > 0 && rawTotal > 0 ? totalKwh / rawTotal : 1;
  const scaledTotal = rawTotal * scale;

  const rows = rawRows.map((row) => {
    const estimatedKwh = row.rawKwh * scale;
    const percentage = scaledTotal > 0 ? (estimatedKwh / scaledTotal) * 100 : 0;
    const monthlyCost = estimatedKwh * tariffPerKwh * 30;
    return {
      ...row,
      estimatedKwh,
      percentage,
      monthlyCost,
      estimatedSavingsPerHourKwh: row.estimatedSavingsPerHourKwh * scale,
    };
  });

  const sortedByUse = [...rows].sort((a, b) => b.estimatedKwh - a.estimatedKwh);
  const top = sortedByUse[0];
  const second = sortedByUse[1];
  const lights = rows.find((row) => row.key === 'lights');

  const aiInsights = [
    top
      ? `${top.category} contribute ${top.percentage.toFixed(1)}% of this building's total energy.`
      : 'Insufficient data for contributor analysis.',
    `Modeled occupancy is ${Math.round(occupancy * 100)}%, driving blended runtime across all categories.`,
    second
      ? `${second.category} are the second-largest load at ${second.estimatedKwh.toFixed(1)} kWh/day.`
      : 'Secondary load insight is unavailable.',
  ];

  const recommendations = [
    top
      ? `Reduce ${top.category} operating hours by 1 hour to save about ${top.estimatedSavingsPerHourKwh.toFixed(1)} kWh/day (${(top.estimatedSavingsPerHourKwh * tariffPerKwh * 30).toFixed(0)} USD/month).`
      : 'Collect a full day of meter data to generate recommendations.',
    second
      ? `Shift 10% of ${second.category} operation away from peak periods to reduce cooling and demand overlap.`
      : 'Add a second major load profile to improve recommendations.',
    lights
      ? `Apply occupancy-driven lighting schedules to trim up to ${(lights.estimatedKwh * 0.12).toFixed(1)} kWh/day from lighting consumption.`
      : 'Lighting control recommendation unavailable.',
  ];

  return {
    occupancy,
    rows,
    totalKwh: scaledTotal,
    tariffPerKwh,
    aiInsights,
    recommendations,
  };
}

function Buildings() {
  const { buildings } = useCampusData();
  const [selectedBuildingId, setSelectedBuildingId] = useState(null);

  const selectedBuilding = useMemo(() => {
    if (!buildings.length) return null;
    const targetId = selectedBuildingId ?? buildings[0]?.id;
    return buildings.find((building) => building.id === targetId) || buildings[0];
  }, [buildings, selectedBuildingId]);

  const deviceModel = useMemo(() => {
    if (!selectedBuilding) return null;
    return estimateDevicesForBuilding(selectedBuilding);
  }, [selectedBuilding]);

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
    value: Number(row.estimatedKwh.toFixed(1)),
  }));

  const topDevice = [...deviceModel.rows].sort((a, b) => b.estimatedKwh - a.estimatedKwh)[0];

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
                Based on device count, wattage, operating hours, and occupancy. No individual IoT sub-meter assumptions.
              </p>
            </div>
            <span className="pill">AI Estimated</span>
          </div>

          <div className="device-section__layout">
            <div className="device-table-wrapper">
              <table className="device-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Count</th>
                    <th>Wattage</th>
                    <th>Run Hours</th>
                    <th>Est. kWh/day</th>
                    <th>Share</th>
                    <th>Status</th>
                    <th>Health</th>
                    <th>Monthly Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceModel.rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.category}</td>
                      <td>{row.count}</td>
                      <td>{row.wattage} W</td>
                      <td>{row.runtimeHours.toFixed(1)} h</td>
                      <td>{row.estimatedKwh.toFixed(1)}</td>
                      <td>{row.percentage.toFixed(1)}%</td>
                      <td>
                        <span className={`device-status ${row.status === 'ON' ? 'device-status--on' : 'device-status--off'}`}>{row.status}</span>
                      </td>
                      <td>
                        <span className={`device-health ${row.healthClass}`}>{row.healthLabel}</span>
                      </td>
                      <td>{row.monthlyCost.toFixed(0)} USD</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="device-chart-wrapper">
              <Chart
                title="Device Energy Mix"
                subtitle="Best fit: Donut/Pie for share, with table for exact values"
                accent="Visual"
                type="pie"
                data={chartData}
                emptyText="No estimated device data"
              />
            </div>
          </div>

          <div className="device-insights-grid">
            <section className="device-panel">
              <h4>AI Insights</h4>
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
| Category | Count | W | Hours | kWh | % | ON/OFF | Health    |
| Monthly Cost per Category                                |   |
+--------------------------------------------------------------+
| AI Insights                          | Recommended Actions   |
+--------------------------------------------------------------+`}</pre>
          </section>
        </section>
      </section>
    </div>
  );
}

export default Buildings;
