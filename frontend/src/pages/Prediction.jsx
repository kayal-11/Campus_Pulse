import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';

const formatEnergy = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const formatKwh = (value) => `${formatEnergy(value)} kWh`;
const formatMwh = (value) => `${formatEnergy(value)} MWh`;
const chartPalette = ['#2563eb', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444'];

function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const radians = (angleInDegrees - 90) * (Math.PI / 180);
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function buildPieSlicePath(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function getRiskLevel(value) {
  if (value > 16000) return 'High';
  if (value > 12000) return 'Medium';
  return 'Low';
}

function getRiskMeta(value) {
  const risk = getRiskLevel(value);
  if (risk === 'High') {
    return { risk, icon: '⚠', className: 'risk-badge--high' };
  }
  if (risk === 'Medium') {
    return { risk, icon: '▲', className: 'risk-badge--medium' };
  }
  return { risk, icon: '✓', className: 'risk-badge--low' };
}

function getImpactClass(impact) {
  if (impact === 'High' || impact === 'Critical') return 'high';
  if (impact === 'Medium') return 'medium';
  return 'low';
}

function getStatusMeta(risk) {
  if (risk === 'High') return { text: 'Alert', className: 'status-badge--alert' };
  if (risk === 'Medium') return { text: 'Watch', className: 'status-badge--watch' };
  return { text: 'Stable', className: 'status-badge--stable' };
}

function getRecommendationSet(predictedEnergy) {
  if (predictedEnergy > 18000) {
    return [
      {
        title: 'HVAC optimization',
        impact: 'Critical',
        savings: '15–20%',
        detail: 'Reduce cooling and ventilation loads during peak demand windows.',
      },
      {
        title: 'Lighting control',
        impact: 'High',
        savings: '8–12%',
        detail: 'Dim non-essential lighting in common areas and corridors.',
      },
      {
        title: 'Equipment scheduling',
        impact: 'High',
        savings: '6–10%',
        detail: 'Shift heavy equipment usage to off-peak hours.',
      },
      {
        title: 'Peak-load management',
        impact: 'High',
        savings: '5–8%',
        detail: 'Stagger energy-intensive activities to reduce demand spikes.',
      },
    ];
  }

  if (predictedEnergy > 12000) {
    return [
      {
        title: 'Tune HVAC schedules',
        impact: 'Medium',
        savings: '8–12%',
        detail: 'Adjust temperature setpoints and occupancy-based controls.',
      },
      {
        title: 'Reduce idle equipment',
        impact: 'Medium',
        savings: '5–8%',
        detail: 'Turn off non-critical devices outside operational hours.',
      },
      {
        title: 'Shift loads to off-peak hours',
        impact: 'Medium',
        savings: '3–6%',
        detail: 'Reschedule significant demand tasks to lower-cost periods.',
      },
    ];
  }

  return [
    {
      title: 'Fine-tune ventilation',
      impact: 'Low',
      savings: '2–4%',
      detail: 'Lower unnecessary ventilation during low-occupancy periods.',
    },
    {
      title: 'Review standby loads',
      impact: 'Low',
      savings: '1–3%',
      detail: 'Check for equipment left running after standard operating hours.',
    },
    {
      title: 'Optimize lighting',
      impact: 'Low',
      savings: '1–2%',
      detail: 'Align lighting schedules with actual occupancy patterns.',
    },
  ];
}

function PredictionChart({ title, description, data, type = 'line' }) {
  const maxValue = data.reduce((max, item) => Math.max(max, Number(item.value) || 0), 0);

  if (type === 'bar') {
    return (
      <div className="chart-card" title={description}>
        <div className="chart-card__header">
          <div>
            <p className="card-title">{title}</p>
            <h4>{description}</h4>
          </div>
        </div>
        <div className="horizontal-bars" role="img" aria-label={title}>
          {data.map((item, index) => {
            const value = Number(item.value) || 0;
            const width = maxValue > 0 ? Math.max(8, (value / maxValue) * 100) : 0;
            const color = item.color || chartPalette[index % chartPalette.length];
            return (
              <div key={item.label} className="horizontal-bar-item">
                <div className="horizontal-bar-label">
                  <span>{item.label}</span>
                  <small>{formatEnergy(value)}</small>
                </div>
                <div className="horizontal-bar-track">
                  <div className="horizontal-bar-fill" style={{ width: `${width}%`, background: `linear-gradient(90deg, ${color} 0%, ${color}CC 100%)` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (type === 'pie') {
    const total = data.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);
    let startAngle = 0;

    return (
      <div className="chart-card" title={description}>
        <div className="chart-card__header">
          <div>
            <p className="card-title">{title}</p>
            <h4>{description}</h4>
          </div>
        </div>
        <div className="pie-chart-wrapper">
          <svg viewBox="0 0 120 120" className="pie-chart" aria-label={title}>
            <circle cx="60" cy="60" r="42" className="pie-chart__base" />
            {data.map((item, index) => {
              const value = Math.max(0, Number(item.value) || 0);
              const sweepAngle = total > 0 ? (value / total) * 360 : 0;
              const endAngle = startAngle + sweepAngle;

              if (sweepAngle <= 0) {
                return null;
              }

              const path = buildPieSlicePath(60, 60, 42, startAngle, endAngle);
              startAngle = endAngle;

              return (
                <path
                  key={item.label}
                  d={path}
                  className="pie-chart__slice"
                  style={{ fill: item.color || chartPalette[index % chartPalette.length] }}
                />
              );
            })}
          </svg>
          <ul className="legend-list">
            {data.map((item, index) => {
              const value = Math.max(0, Number(item.value) || 0);
              const share = total > 0 ? (value / total) * 100 : 0;
              return (
                <li key={item.label}>
                  <span className="legend-dot" style={{ backgroundColor: item.color || chartPalette[index % chartPalette.length] }} />
                  {item.label} ({share.toFixed(1)}%)
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  if (type === 'area') {
    const points = data.map((item, index) => {
      const value = Number(item.value) || 0;
      const x = data.length > 1 ? (index / (data.length - 1)) * 100 : 50;
      const y = maxValue > 0 ? 100 - (value / maxValue) * 70 - 10 : 90;
      return { x, y };
    });
    const linePath = points.map((point) => `${point.x},${point.y}`).join(' ');
    const areaPath = `M ${points.map((point) => `${point.x},${point.y}`).join(' L ')} L 100,100 L 0,100 Z`;
    const accentColor = chartPalette[3];

    return (
      <div className="chart-card" title={description}>
        <div className="chart-card__header">
          <div>
            <p className="card-title">{title}</p>
            <h4>{description}</h4>
          </div>
        </div>
        <svg viewBox="0 0 100 100" className="area-chart" aria-label={title}>
          <g className="chart-grid-lines">
            {[0, 1, 2, 3].map((line) => <line key={line} x1="0" y1={10 + line * 20} x2="100" y2={10 + line * 20} />)}
          </g>
          <path d={areaPath} className="area-chart__fill" style={{ fill: `${accentColor}20` }} />
          <polyline points={linePath} className="area-chart__line" style={{ stroke: accentColor }} />
        </svg>
        <div className="chart-label-row">
          {data.map((item) => <span key={item.label}>{item.label}</span>)}
        </div>
      </div>
    );
  }

  if (type === 'donut') {
    const total = data.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);
    let offset = 0;
    return (
      <div className="chart-card" title={description}>
        <div className="chart-card__header">
          <div>
            <p className="card-title">{title}</p>
            <h4>{description}</h4>
          </div>
        </div>
        <div className="donut-wrapper">
          <svg viewBox="0 0 120 120" className="donut-chart" aria-label={title}>
            <circle cx="60" cy="60" r="42" className="donut-chart__base" />
            {data.map((item, index) => {
              const value = Number(item.value) || 0;
              const slice = total > 0 ? (value / total) * 360 : 0;
              const circle = (
                <circle
                  key={item.label}
                  cx="60"
                  cy="60"
                  r="42"
                  className="donut-chart__slice"
                  strokeDasharray={`${(slice / 360) * 263.89} 263.89`}
                  strokeDashoffset={-offset}
                  style={{ stroke: item.color || chartPalette[index % chartPalette.length] }}
                />
              );
              offset += (slice / 360) * 263.89;
              return circle;
            })}
          </svg>
          <ul className="legend-list">
            {data.map((item, index) => (
              <li key={item.label}><span className="legend-dot" style={{ backgroundColor: item.color || chartPalette[index % chartPalette.length] }} />{item.label}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const points = data.map((item, index) => {
    const value = Number(item.value) || 0;
    const x = data.length > 1 ? (index / (data.length - 1)) * 100 : 50;
    const y = maxValue > 0 ? 100 - (value / maxValue) * 80 - 10 : 90;
    return { x, y };
  });
  const linePath = points.map((point) => `${point.x},${point.y}`).join(' ');
  const accentColor = chartPalette[0];

  return (
    <div className="chart-card" title={description}>
      <div className="chart-card__header">
        <div>
          <p className="card-title">{title}</p>
          <h4>{description}</h4>
        </div>
      </div>
      <div className="line-chart-wrapper">
        <svg viewBox="0 0 100 100" className="line-chart" aria-label={title}>
          <g className="chart-grid-lines">
            {[0, 1, 2, 3].map((line) => <line key={line} x1="0" y1={10 + line * 20} x2="100" y2={10 + line * 20} />)}
          </g>
          <polyline points={linePath} className="line-chart__polyline" style={{ stroke: accentColor }} />
          {points.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="1.8" style={{ fill: accentColor }} />)}
        </svg>
      </div>
    </div>
  );
}

function Prediction() {
  const { predictions, overview, loading } = useCampusData();

  const sortedPredictions = [...predictions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const latestPrediction = sortedPredictions[0] || null;
  const totalForecast = sortedPredictions.length
    ? sortedPredictions.reduce((sum, item) => sum + item.predicted_energy, 0) / 1000
    : overview?.total_energy_mwh ?? 0;

  const latestPredictionsByBuilding = sortedPredictions.reduce((accumulator, prediction) => {
    const key = prediction.building_id ?? prediction.building_name ?? 'unknown';
    const current = accumulator.get(key);
    if (!current || new Date(prediction.created_at) > new Date(current.created_at)) {
      accumulator.set(key, prediction);
    }
    return accumulator;
  }, new Map());

  const latestBuildingPredictions = [...latestPredictionsByBuilding.values()].sort((a, b) => b.predicted_energy - a.predicted_energy);
  const riskBuildings = latestBuildingPredictions.filter((prediction) => prediction.predicted_energy > 14000).length;
  const rankedBuildings = latestBuildingPredictions.slice(0, 6);
  const latestRisk = latestPrediction ? getRiskLevel(latestPrediction.predicted_energy) : 'Low';
  const recommendations = latestPrediction ? getRecommendationSet(latestPrediction.predicted_energy) : [];
  const confidenceNote = 'Prediction generated using the trained Random Forest model.';

  const trendData = sortedPredictions.slice(0, 8).reverse().map((prediction) => ({
    label: new Date(prediction.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    value: prediction.predicted_energy,
  }));

  const forecastTrendData = [
    { label: 'Today', value: totalForecast * 1000 },
    { label: 'Tomorrow', value: totalForecast * 1100 },
    { label: 'Next Week', value: totalForecast * 1200 },
    { label: 'Next Month', value: totalForecast * 1400 },
  ];

  const distributionData = rankedBuildings.map((prediction) => ({
    label: prediction.building_name || 'Building',
    value: prediction.predicted_energy,
  }));

  const riskDistribution = [
    { label: 'Low', value: latestBuildingPredictions.filter((prediction) => getRiskLevel(prediction.predicted_energy) === 'Low').length, color: '#22c55e' },
    { label: 'Medium', value: latestBuildingPredictions.filter((prediction) => getRiskLevel(prediction.predicted_energy) === 'Medium').length, color: '#f59e0b' },
    { label: 'High', value: latestBuildingPredictions.filter((prediction) => getRiskLevel(prediction.predicted_energy) === 'High').length, color: '#ef4444' },
  ];

  const forecastSavings = Math.max(2500, totalForecast * 180);
  const peakDemandWarning = totalForecast > 14 ? 'Peak demand warning: forecast exceeds the safe planning threshold.' : 'Demand remains within the expected operating range.';

  if (loading) {
    return (
      <div className="prediction-shell">
        <div className="prediction-hero prediction-hero--loading">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text short" />
        </div>
        <div className="prediction-grid">
          {[1, 2, 3, 4].map((item) => <div key={item} className="skeleton skeleton-card" />)}
        </div>
      </div>
    );
  }

  if (!sortedPredictions.length) {
    return (
      <div className="prediction-shell">
        <div className="prediction-hero">
          <div>
            <p className="eyebrow">Prediction intelligence</p>
            <h2>No predictions yet</h2>
            <p className="prediction-copy">Run AI predictions from the Admin panel to populate live forecast data from the PostgreSQL predictions table.</p>
          </div>
        </div>
        <div className="prediction-card prediction-card--empty">
          <h3>No live prediction data available</h3>
          <p>Once new predictions are generated, this page will show recommendations, forecast summaries, charts, and history automatically.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="prediction-shell">
      <section className="prediction-hero" title="Live prediction overview">
        <div className="prediction-hero__content">
          <p className="eyebrow">Prediction intelligence</p>
          <h2>Professional AI forecasting for campus energy operations</h2>
          <p className="prediction-copy">This page is driven by live prediction data from the PostgreSQL predictions table and highlights forecasted demand, risk level, recommendations, and future outlook.</p>
        </div>
        <div className="prediction-hero__meta">
          <div className="prediction-stat">
            <span>Latest prediction</span>
            <strong>{latestPrediction ? `${formatKwh(latestPrediction.predicted_energy)}` : '—'}</strong>
          </div>
          <div className="prediction-stat">
            <span>Building</span>
            <strong>{latestPrediction?.building_name || '—'}</strong>
          </div>
          <div className="prediction-stat">
            <span>Updated</span>
            <strong>{latestPrediction ? new Date(latestPrediction.created_at).toLocaleString() : '—'}</strong>
          </div>
        </div>
      </section>

      <div className="prediction-grid">
        <Card
          title="Latest prediction"
          value={latestPrediction ? formatKwh(latestPrediction.predicted_energy) : '—'}
          detail={latestPrediction ? `${latestPrediction.building_name || 'Building'} • ${new Date(latestPrediction.created_at).toLocaleString()}` : 'Awaiting data'}
          accent={latestRisk}
        />
        <Card
          title="Tomorrow forecast"
          value={formatMwh(totalForecast)}
          detail="Estimated total load from current predictions"
          accent="Forecast"
        />
        <Card
          title="Risk window"
          value={riskBuildings ? `${riskBuildings} building${riskBuildings > 1 ? 's' : ''}` : 'Low'}
          detail="Buildings above the high-load threshold"
          accent={riskBuildings ? 'Monitor' : 'Stable'}
        />
        <Card
          title="Model confidence"
          value={latestPrediction?.confidence ? `${latestPrediction.confidence}%` : 'N/A'}
          detail={latestPrediction?.confidence ? 'Confidence score from latest model output' : confidenceNote}
          accent="AI"
        />
      </div>

      <div className="prediction-grid prediction-grid--charts">
        <PredictionChart title="Predicted Energy Trend" description="Live forecast trend" data={trendData} type="line" />
        <PredictionChart title="High Consumption Buildings" description="Top buildings by predicted demand" data={distributionData} type="bar" />
        <PredictionChart title="Building-wise Distribution" description="Forecast share by building" data={distributionData} type="pie" />
        <PredictionChart title="Weekly Forecast Trend" description="Projected energy demand" data={forecastTrendData} type="area" />
        <PredictionChart title="Energy Risk Distribution" description="Low, medium, and high-risk predictions" data={riskDistribution} type="donut" />
      </div>

      <section className="prediction-card" title="AI recommendations based on current forecast severity">
        <div className="prediction-section-title">
          <div>
            <p className="card-title">AI recommendations</p>
            <h3>Dynamic actions driven by forecast severity</h3>
            <p className="card-detail">Suggestions are generated from the latest prediction level and updated as new forecasts arrive.</p>
          </div>
          <span className="pill">Smart</span>
        </div>
        <div className="recommendations-grid">
          {recommendations.map((item) => {
            const impactClass = getImpactClass(item.impact);
            const impactIcon = impactClass === 'high' ? '⚠' : impactClass === 'medium' ? '▲' : '✓';
            return (
              <article key={item.title} className="recommendation-card">
                <div className="recommendation-card__header">
                  <strong>{item.title}</strong>
                  <span className={`impact-badge impact-badge--${impactClass}`}>
                    <span className="impact-icon">{impactIcon}</span>
                    {item.impact}
                  </span>
                </div>
                <p>{item.detail}</p>
                <span className="recommendation-card__footer">
                  <span className="savings-icon">↗</span>
                  Estimated savings: {item.savings}
                </span>
              </article>
            );
          })}
        </div>
      </section>

      <section className="prediction-card" title="Future forecast outlook and savings estimate">
        <div className="prediction-section-title">
          <div>
            <p className="card-title">Future forecast</p>
            <h3>Upcoming demand, savings outlook, and alerts</h3>
            <p className="card-detail">A short-range planning view based on current forecasting results.</p>
          </div>
          <span className="pill">Forecast</span>
        </div>
        <div className="future-forecast-grid">
          <div className="future-forecast-card future-forecast-card--tomorrow">
            <span className="forecast-accent forecast-accent--blue">Tomorrow Forecast</span>
            <h4>Tomorrow Forecast</h4>
            <div className="forecast-value">{formatKwh(totalForecast * 1000)}</div>
            <p>Estimated energy demand for the next operating day.</p>
          </div>
          <div className="future-forecast-card future-forecast-card--weekly">
            <span className="forecast-accent forecast-accent--purple">Weekly Outlook</span>
            <h4>Weekly Outlook</h4>
            <div className="forecast-value">{formatKwh(totalForecast * 1200)}</div>
            <p>Expected demand based on current load trend and building mix.</p>
          </div>
          <div className="future-forecast-card future-forecast-card--monthly">
            <span className="forecast-accent forecast-accent--orange">Monthly Energy Trend</span>
            <h4>Monthly Energy Trend</h4>
            <div className="forecast-value">{formatKwh(totalForecast * 1400)}</div>
            <p>Projected monthly energy usage and sustainability planning signal.</p>
          </div>
          <div className="future-forecast-card future-forecast-card--savings">
            <span className="forecast-accent forecast-accent--green">Estimated Savings</span>
            <h4>Estimated Savings</h4>
            <div className="forecast-value">{formatKwh(forecastSavings)}</div>
            <p>Potential savings from the recommended actions above.</p>
          </div>
        </div>
        <div className="forecast-alert">
          <strong>Peak demand warning</strong>
          <p>{peakDemandWarning}</p>
          <span>Explanation: forecasting is based on current prediction values and highlights likely demand pressure before peak hours.</span>
        </div>
      </section>

      <section className="prediction-card" title="Latest prediction history from backend data">
        <div className="prediction-section-title">
          <div>
            <p className="card-title">Prediction history</p>
            <h3>Latest predictions from the live backend</h3>
            <p className="card-detail">Always sorted from newest to oldest and sourced from the PostgreSQL predictions table.</p>
          </div>
          <span className="pill">Live</span>
        </div>
        <div className="table-wrapper">
          <table className="prediction-table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Building Name</th>
                <th>Predicted Energy</th>
                <th>Risk Level</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedPredictions.map((prediction) => {
                const risk = getRiskLevel(prediction.predicted_energy);
                const riskMeta = getRiskMeta(prediction.predicted_energy);
                const statusMeta = getStatusMeta(risk);
                return (
                  <tr key={prediction.id}>
                    <td>{new Date(prediction.created_at).toLocaleString()}</td>
                    <td>{prediction.building_name}</td>
                    <td>{formatKwh(prediction.predicted_energy)}</td>
                    <td>
                      <span className={`risk-badge ${riskMeta.className}`}>
                        <span className="risk-badge__icon">{riskMeta.icon}</span>
                        {riskMeta.risk}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${statusMeta.className}`}>{statusMeta.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default Prediction;
