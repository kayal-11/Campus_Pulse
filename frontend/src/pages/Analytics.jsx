import Card from '../components/Card';
import Chart from '../components/Chart';
import { useCampusData } from '../context/CampusDataContext';

function Analytics() {
  const { overview, buildings, alerts, energy } = useCampusData();

  const stableCount = buildings.filter((b) => b.status === 'Stable').length;
  const score = buildings.length
    ? Math.min(99, Math.round(75 + (stableCount / buildings.length) * 20))
    : 0;
  const savings = overview ? Math.round(overview.total_energy_mwh * 380) : 0;
  const outliers = alerts.filter((a) => a.priority === 'high').length;
  const buildingLoadData = buildings.length
    ? buildings
        .map((building) => ({
          label: building.name,
          value: Number(building.latest_reading) || (building.status === 'Stable' ? 60 : building.status === 'Active' ? 90 : 120),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)
    : [{ label: 'No data', value: 0 }];
  const distributionData = buildings.length
    ? buildings
        .map((building) => ({
          label: building.name,
          value: Number(building.latest_reading) || 1,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)
    : [{ label: 'No data', value: 0 }];
  const energyTrendData = energy.length
    ? [...energy]
        .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
        .slice(-7)
        .map((entry) => ({
          label: new Date(entry.recorded_at).toLocaleDateString(undefined, { weekday: 'short' }),
          value: Number(entry.meter_reading) || 0,
        }))
    : [{ label: 'No data', value: 0 }];

  return (
    <div className="page-content">
      <div className="page-grid analytics-grid">
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

      <div className="page-grid analytics-grid">
        <div className="analytics-chart-card">
          <Chart
            title="Energy distribution"
            subtitle="Pie-style distribution"
            type="pie"
            data={distributionData}
            emptyText="No distribution data available yet"
            accent="Live"
          />
        </div>
        <div className="analytics-chart-card">
          <Chart
            title="Top energy buildings"
            subtitle="Highest consuming buildings"
            type="bar"
            barOrientation="horizontal"
            data={buildingLoadData}
            emptyText="No building performance data available yet"
            accent="Monitor"
          />
        </div>
        <div className="analytics-chart-card">
          <Chart
            title="Operations center"
            subtitle="Daily trend overview"
            type="line"
            lineOptions={{ dynamicYAxis: true, smooth: true, markerSolid: true, markerRadius: 1.6 }}
            data={energyTrendData}
            emptyText="No trend data available yet"
            accent="Live"
          />
        </div>
      </div>
    </div>
  );
}

export default Analytics;
