import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';

function Dashboard() {
  const { overview, buildings, alerts, predictions } = useCampusData();

  const efficient = buildings.filter((b) => b.status === 'Stable').length;
  const occupancy = buildings.length
    ? Math.round((buildings.filter((b) => b.status === 'Active').length / buildings.length) * 100)
    : 0;
  const openAlerts = alerts.filter((a) => a.status === 'open').length;
  const latestPred = predictions[0];

  return (
    <div className="page-grid">
      <Card
        title="Campus overview"
        value={overview ? `${overview.building_count} buildings` : '—'}
        detail={`${efficient} high-efficiency zones online`}
        accent="Balanced"
      />
      <Card
        title="Occupancy sync"
        value={`${occupancy}%`}
        detail="Active buildings matched to peak schedules"
        accent="Healthy"
      />
      <Card
        title="Open alerts"
        value={String(openAlerts)}
        detail={openAlerts ? 'Requires operator attention' : 'All systems within SLA'}
        accent={openAlerts ? 'Monitor' : 'Clear'}
      />
      <Card
        title="Latest prediction"
        value={latestPred ? `${(latestPred.predicted_energy / 1000).toFixed(1)} MWh` : '—'}
        detail={latestPred ? `${latestPred.building_name} forecast` : 'Run AI from Admin'}
        accent="Forecast"
      />
    </div>
  );
}

export default Dashboard;
