import Card from '../components/Card';
import Chart from '../components/Chart';
import { useCampusData } from '../context/CampusDataContext';

function Home() {
  const { overview, trend, alerts, liveStatus, buildings } = useCampusData();

  const openAlerts = alerts.filter((a) => a.status === 'open').length;
  const highAlerts = alerts.filter((a) => a.priority === 'high' && a.status === 'open').length;
  const isEmpty = buildings.length === 0;

  return (
    <div className="page-grid">
      {isEmpty && (
        <section className="empty-banner">
          <p>Your campus is empty. Go to <strong>Admin</strong> and click <strong>➕ Add Building</strong> to get started.</p>
        </section>
      )}
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Sustainable operations · {liveStatus === 'live' ? 'Real-time' : 'Syncing'}</p>
          <h2>Monitor campus energy use with clarity and confidence.</h2>
          <p className="hero-copy">
            See demand patterns, identify savings opportunities, and respond to alerts in real time.
          </p>
        </div>
        <div className="hero-metrics">
          <div>
            <strong>{overview ? `${overview.peak_reduction_pct}%` : '—'}</strong>
            <span>Peak reduction</span>
          </div>
          <div>
            <strong>{overview ? `${overview.avg_per_building_kwh} kWh` : '—'}</strong>
            <span>Avg. per building</span>
          </div>
        </div>
      </section>

      <Card
        title="Live consumption"
        value={overview ? `${overview.total_energy_mwh} MWh` : '—'}
        detail={overview?.last_refresh ? `Updated ${new Date(overview.last_refresh).toLocaleTimeString()}` : 'Fetching data…'}
        accent="Live"
      />
      <Card
        title="Demand response"
        value={overview ? `${overview.demand_response_active} active` : '—'}
        detail={`${overview?.building_count ?? 0} buildings monitored`}
        accent="On track"
      />
      <Chart title="Energy trend" data={trend.length ? trend : [{ label: '—', value: 0 }]} />

      <Card
        title="Priority alerts"
        value={openAlerts ? `${openAlerts} open` : 'All clear'}
        footer={highAlerts ? `${highAlerts} high priority need review` : 'No critical anomalies'}
      />
      <Card
        title="AI predictions"
        value={overview ? `${overview.prediction_count} stored` : '—'}
        footer="Run predictions from Admin panel"
      />
    </div>
  );
}

export default Home;
