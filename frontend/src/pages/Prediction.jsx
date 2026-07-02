import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';

function Prediction() {
  const { predictions, overview } = useCampusData();

  const totalForecast = predictions.length
    ? predictions.reduce((sum, p) => sum + p.predicted_energy, 0) / 1000
    : overview?.total_energy_mwh ?? 0;

  const riskBuildings = predictions.filter((p) => p.predicted_energy > 14000).length;
  const scenarios = Math.min(5, Math.max(1, predictions.length));

  return (
    <div className="page-grid">
      <Card
        title="Tomorrow forecast"
        value={`${totalForecast.toFixed(1)} MWh`}
        detail="Estimated from latest AI predictions"
        accent="Forecast"
      />
      <Card
        title="Risk window"
        value={riskBuildings ? `${riskBuildings} building${riskBuildings > 1 ? 's' : ''}` : 'Low'}
        detail="Likely peak exposure after 16:00"
        accent={riskBuildings ? 'Monitor' : 'Stable'}
      />
      <Card
        title="Scenario planner"
        value={`${scenarios} option${scenarios > 1 ? 's' : ''}`}
        detail="Suggested actions for demand smoothing"
        accent="Ready"
      />
    </div>
  );
}

export default Prediction;
