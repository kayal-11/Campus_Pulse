import Card from '../components/Card';
import Chart from '../components/Chart';
import { useCampusData } from '../context/CampusDataContext';

function Dashboard() {
  const { overview, buildings, alerts, predictions, energy, liveStatus } = useCampusData();
  const sortedPredictions = [...predictions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const efficient = buildings.filter((b) => b.status === 'Stable').length;
  const openAlerts = alerts.filter((a) => a.status === 'open').length;
  const latestPred = sortedPredictions[0];
  const trendData = energy.length
    ? (() => {
        const dailyLatest = energy.reduce((accumulator, entry) => {
          const timestamp = new Date(entry.recorded_at);
          const dayKey = timestamp.toISOString().slice(0, 10);
          const current = accumulator.get(dayKey);

          if (!current || new Date(entry.recorded_at) > new Date(current.recorded_at)) {
            accumulator.set(dayKey, entry);
          }

          return accumulator;
        }, new Map());

        return [...dailyLatest.values()]
          .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
          .slice(-7)
          .map((entry) => ({
            label: new Date(entry.recorded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
            value: Number(entry.meter_reading) || 0,
          }));
      })()
    : [{ label: 'No data', value: 0 }];
  const latestPredictionsByBuilding = sortedPredictions.reduce((accumulator, prediction) => {
    const key = prediction.building_id ?? prediction.building_name ?? 'unknown';
    const current = accumulator.get(key);
    if (!current || new Date(prediction.created_at) > new Date(current.created_at)) {
      accumulator.set(key, prediction);
    }
    return accumulator;
  }, new Map());

  const latestBuildingPredictions = [...latestPredictionsByBuilding.values()].sort((a, b) => b.predicted_energy - a.predicted_energy);

  const latestEnergyByBuilding = energy.reduce((accumulator, reading) => {
    const key = reading.building_id ?? reading.building_name ?? 'unknown';
    const current = accumulator.get(key);
    if (!current || new Date(reading.recorded_at) > new Date(current.recorded_at)) {
      accumulator.set(key, reading);
    }
    return accumulator;
  }, new Map());

  const alignedBuildings = latestBuildingPredictions.reduce((count, prediction) => {
    const latestReading = latestEnergyByBuilding.get(prediction.building_id ?? prediction.building_name ?? 'unknown');
    if (!latestReading) return count;

    const predictedValue = Number(prediction.predicted_energy) || 0;
    const actualValue = Number(latestReading.meter_reading) || 0;
    if (predictedValue <= 0) return count;

    const deviation = Math.abs(actualValue - predictedValue) / predictedValue;
    return deviation <= 0.15 ? count + 1 : count;
  }, 0);

  const occupancyTotal = latestBuildingPredictions.length;
  const occupancy = occupancyTotal ? Math.round((alignedBuildings / occupancyTotal) * 100) : 0;
  const occupancyDetail = occupancyTotal
    ? `${alignedBuildings} of ${occupancyTotal} buildings aligned with live forecast`
    : 'Awaiting live prediction alignment';

  const latestPredictionDetail = latestPred
    ? `${latestPred.building_name} forecast - Updated ${new Date(latestPred.created_at).toLocaleTimeString()}`
    : 'Run AI from Admin';

  const buildingLoadData = latestBuildingPredictions.length
    ? latestBuildingPredictions.slice(0, 6).map((prediction) => ({
        label: prediction.building_name || 'Building',
        value: Number(prediction.predicted_energy) || 0,
      }))
    : [{ label: 'No data', value: 0 }];

  return (
    <div className="page-content">
      <div className="page-grid">
        <Card
          title="Total energy"
          value={overview ? `${overview.total_energy_mwh} MWh` : '—'}
          detail="Combined latest demand"
          accent="Live"
        />
        <Card
          title="Buildings"
          value={String(buildings.length)}
          detail={`${efficient} high-efficiency zones online`}
          accent="Managed"
        />
        <Card
          title="Alerts"
          value={String(openAlerts)}
          detail={openAlerts ? 'Requires operator attention' : 'All systems within SLA'}
          accent={openAlerts ? 'Monitor' : 'Clear'}
        />
        <Card
          title="Live status"
          value={liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : 'Offline'}
          detail="Real-time monitoring"
          accent="Sync"
        />
      </div>

      <div className="page-grid">
        <div className="analytics-chart-card">
          <Chart
            title="Energy trend"
            subtitle="Daily energy trend"
            type="line"
            lineOptions={{ dynamicYAxis: true, smooth: true, markerSolid: true, markerRadius: 1.6 }}
            data={trendData}
            emptyText="No trend data available yet"
            accent="Live"
          />
        </div>
        <div className="analytics-chart-card">
          <Chart
            title="Building load"
            subtitle="Building-wise energy"
            type="bar"
            barOrientation="horizontal"
            data={buildingLoadData}
            emptyText="No building load data yet"
            accent="Monitor"
          />
        </div>
      </div>

      <div className="page-grid">
        <Card
          title="Latest prediction"
          value={latestPred ? `${(latestPred.predicted_energy / 1000).toFixed(1)} MWh` : '—'}
          detail={latestPredictionDetail}
          accent="Forecast"
        />
        <Card
          title="Occupancy sync"
          value={`${occupancy}%`}
          detail={occupancyDetail}
          accent="Healthy"
        />
      </div>
    </div>
  );
}

export default Dashboard;
