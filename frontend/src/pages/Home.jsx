import Card from '../components/Card';
import Chart from '../components/Chart';
import { useCampusData } from '../context/CampusDataContext';

function Home() {
  const { overview, trend, alerts, liveStatus, buildings, predictions, loading } = useCampusData();

  const openAlertsList = alerts.filter((alert) => String(alert.status || '').toLowerCase() === 'open');
  const openAlerts = openAlertsList.length;
  const highAlerts = openAlertsList.filter((alert) => {
    const priority = String(alert.priority || '').toLowerCase();
    return priority === 'high' || priority === 'critical';
  }).length;
  const isAllClearAlert = alerts.some((alert) => alert.id === 'all-clear');
  const priorityValue = loading ? 'Checking...' : openAlerts ? `${openAlerts} open` : 'All clear';
  const priorityDetail = loading
    ? 'Analyzing live anomalies'
    : isAllClearAlert || !openAlerts
      ? 'No critical anomalies'
      : `${highAlerts} high priority need review`;
  const priorityFooter = !loading && openAlertsList[0]
    ? `${openAlertsList[0].building_name}: ${openAlertsList[0].title}`
    : undefined;
  const isEmpty = buildings.length === 0;

  const liveSeries = (trend.length
    ? trend.slice(-8).map((item) => Number(item.value ?? item.meter_reading ?? 0))
    : overview
      ? [
          Number(overview.total_energy_mwh) * 0.92,
          Number(overview.total_energy_mwh) * 0.96,
          Number(overview.total_energy_mwh),
        ]
      : []);

  const liveMin = liveSeries.length ? Math.min(...liveSeries) : 0;
  const liveMax = liveSeries.length ? Math.max(...liveSeries) : 0;
  const liveRange = Math.max(liveMax - liveMin, 0.001);
  const liveSparkPoints = liveSeries.map((value, index) => {
    const x = liveSeries.length > 1 ? (index / (liveSeries.length - 1)) * 100 : 50;
    const y = 30 - ((value - liveMin) / liveRange) * 24;
    return { x, y };
  });
  const liveSparkPolyline = liveSparkPoints.map((point) => `${point.x},${point.y}`).join(' ');
  const liveSeriesMin = liveSeries.length ? Math.min(...liveSeries) : 0;
  const liveSeriesMax = liveSeries.length ? Math.max(...liveSeries) : 0;
  const liveLatestValue = liveSeries.length ? liveSeries[liveSeries.length - 1] : 0;
  const liveWindowStart = overview?.last_refresh
    ? new Date(new Date(overview.last_refresh).getTime() - Math.max(1, liveSeries.length - 1) * 60 * 60 * 1000)
    : null;
  const liveWindowEnd = overview?.last_refresh ? new Date(overview.last_refresh) : null;

  const demandActive = Number(overview?.demand_response_active ?? 0);
  const demandBuildings = Number(overview?.building_count ?? 0);
  const demandRatio = demandBuildings > 0 ? Math.min(100, (demandActive / demandBuildings) * 100) : 0;

  const latestPredictionsByBuilding = [...predictions]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .reduce((accumulator, prediction) => {
      const key = prediction.building_id ?? prediction.building_name ?? 'unknown';
      if (!accumulator.has(key)) {
        accumulator.set(key, prediction);
      }
      return accumulator;
    }, new Map());

  const latestPredictionValues = [...latestPredictionsByBuilding.values()].map((prediction) => Number(prediction.predicted_energy) || 0);
  const predictedAverage = latestPredictionValues.length
    ? latestPredictionValues.reduce((sum, value) => sum + value, 0) / latestPredictionValues.length
    : Number(overview?.avg_per_building_kwh ?? 0);
  const predictedPeakReduction = latestPredictionValues.length >= 2
    ? (() => {
        const max = Math.max(...latestPredictionValues);
        const min = Math.min(...latestPredictionValues);
        if (max <= 0) return Number(overview?.peak_reduction_pct ?? 0);
        return ((max - min) / max) * 100;
      })()
    : Number(overview?.peak_reduction_pct ?? 0);

  const formattedPeakReduction = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
  }).format(predictedPeakReduction);

  const formattedAvgPerBuilding = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(predictedAverage);

  const currentMonth = new Date().toLocaleDateString(undefined, { month: 'short' });
  const trendWithMonth = trend.length
    ? trend.map((point, index) => ({
        ...point,
        label: `${point.label} ${index + 1}`,
      }))
    : [{ label: '— 0', value: 0 }];

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
            <strong>{overview || latestPredictionValues.length ? `${formattedPeakReduction}%` : '—'}</strong>
            <span>Peak reduction</span>
          </div>
          <div>
            <strong>{overview || latestPredictionValues.length ? `${formattedAvgPerBuilding} kWh` : '—'}</strong>
            <span>Avg. per building</span>
          </div>
        </div>
      </section>

      <Card
        title="Live consumption"
        value={overview ? `${overview.total_energy_mwh} MWh` : '—'}
        detail={overview?.last_refresh ? `Updated ${new Date(overview.last_refresh).toLocaleTimeString()}` : 'Fetching data…'}
        accent="Live"
      >
        <div className="home-mini-chart" aria-label="Live consumption mini trend">
          {liveSparkPoints.length ? (
            <>
              <div className="home-mini-chart__meta">
                <span>Y: {liveSeriesMin.toFixed(2)} - {liveSeriesMax.toFixed(2)} MWh</span>
                <strong>{liveLatestValue.toFixed(2)} MWh</strong>
              </div>
              <svg viewBox="0 0 100 34" preserveAspectRatio="none">
                <line x1="0" y1="30" x2="100" y2="30" className="home-mini-chart__axis" />
                <line x1="0" y1="2" x2="0" y2="30" className="home-mini-chart__axis" />
                <polyline points={liveSparkPolyline} />
                {liveSparkPoints.map((point, index) => (
                  <circle key={`live-point-${index}`} cx={point.x} cy={point.y} r="2" className="home-mini-chart__point" />
                ))}
              </svg>
              <div className="home-mini-chart__xlabels">
                <span>{liveWindowStart ? liveWindowStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Start'}</span>
                <span>{liveWindowEnd ? liveWindowEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}</span>
              </div>
            </>
          ) : (
            <span className="home-mini-chart__empty">Waiting for readings</span>
          )}
        </div>
      </Card>
      <Card
        title="Demand response"
        value={overview ? `${overview.demand_response_active} active` : '—'}
        detail={`${overview?.building_count ?? 0} buildings monitored`}
        accent="On track"
      >
        <div className="demand-mini-chart" aria-label="Demand response activity meter">
          <div className="demand-mini-chart__track">
            <div className="demand-mini-chart__fill" style={{ width: `${demandRatio}%` }} />
          </div>
          <div className="demand-mini-chart__meta">
            <span>Active</span>
            <strong>{demandRatio.toFixed(1)}%</strong>
          </div>
        </div>
      </Card>
      <Chart
        title="Energy trend"
        subtitle={`Weekly load profile (${currentMonth})`}
        type="line"
        data={trendWithMonth}
      />

      <Card
        title="Priority alerts"
        value={priorityValue}
        detail={priorityDetail}
        footer={priorityFooter}
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
