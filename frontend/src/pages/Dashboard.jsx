import Card from '../components/Card';
import Chart from '../components/Chart';
import { useCampusData } from '../context/CampusDataContext';

function Dashboard() {
  const { overview, buildings, alerts, predictions, energy, liveStatus } = useCampusData();

  const efficient = buildings.filter((b) => b.status === 'Stable').length;
  const occupancy = buildings.length
    ? Math.round((buildings.filter((b) => b.status === 'Active').length / buildings.length) * 100)
    : 0;
  const openAlerts = alerts.filter((a) => a.status === 'open').length;
  const latestPred = predictions[0];
  const trendData = energy.length
    ? [...energy]
        .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
        .slice(-7)
        .map((entry) => ({
          label: new Date(entry.recorded_at).toLocaleDateString(undefined, { weekday: 'short' }),
          value: Number(entry.meter_reading) || 0,
        }))
    : [{ label: 'No data', value: 0 }];
  const buildingLoadData = buildings.length
    ? buildings
        .map((building) => ({
          label: building.name,
          value: Number(building.latest_reading) || (building.status === 'Stable' ? 60 : 95),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)
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
          detail={latestPred ? `${latestPred.building_name} forecast` : 'Run AI from Admin'}
          accent="Forecast"
        />
        <Card
          title="Occupancy sync"
          value={`${occupancy}%`}
          detail="Active buildings matched to peak schedules"
          accent="Healthy"
        />
      </div>
    </div>
  );
}

export default Dashboard;
