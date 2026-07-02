import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';

function Analytics() {
  const { overview, buildings, alerts } = useCampusData();

  const stableCount = buildings.filter((b) => b.status === 'Stable').length;
  const score = buildings.length
    ? Math.min(99, Math.round(75 + (stableCount / buildings.length) * 20))
    : 0;
  const savings = overview ? Math.round(overview.total_energy_mwh * 380) : 0;
  const outliers = alerts.filter((a) => a.priority === 'high').length;

  return (
    <div className="page-grid">
      <Card
        title="Efficiency score"
        value={`${score}/100`}
        detail="Performance across all monitored wings"
        accent="Excellent"
      />
      <Card
        title="Savings forecast"
        value={savings ? `$${(savings / 1000).toFixed(1)}k` : '—'}
        detail="Projected for next quarter"
        accent="Positive"
      />
      <Card
        title="Outlier detection"
        value={`${outliers} case${outliers !== 1 ? 's' : ''}`}
        detail={outliers ? 'Flagged for investigation' : 'No anomalies detected'}
        accent={outliers ? 'Monitor' : 'Clear'}
      />
    </div>
  );
}

export default Analytics;
