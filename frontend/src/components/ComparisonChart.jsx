function ComparisonChart({ title, data, subtitle = 'Predicted vs actual', emptyText = 'No comparison data yet', accent = 'Forecast' }) {
  const safeData = Array.isArray(data) ? data.filter((item) => item && item.label) : [];
  const maxValue = safeData.reduce((max, item) => Math.max(max, Number(item.predicted) || 0, Number(item.actual) || 0), 0);

  return (
    <section className="card chart-card">
      <div className="card-header">
        <div>
          <p className="card-title">{title}</p>
          <h3>{subtitle}</h3>
        </div>
        <span className="pill">{accent}</span>
      </div>
      {safeData.length ? (
        <div className="comparison-chart" aria-label="Prediction comparison chart">
          {safeData.map((item) => {
            const predicted = Number(item.predicted) || 0;
            const actual = Number(item.actual) || 0;
            const predictedWidth = maxValue > 0 ? Math.max(8, (predicted / maxValue) * 100) : 0;
            const actualWidth = maxValue > 0 ? Math.max(8, (actual / maxValue) * 100) : 0;
            return (
              <div key={item.label} className="comparison-row">
                <div className="comparison-label">
                  <strong>{item.label}</strong>
                  <span>Pred {predicted.toFixed(0)} · Act {actual.toFixed(0)}</span>
                </div>
                <div className="comparison-bars">
                  <div className="comparison-bar-group">
                    <div className="comparison-track">
                      <div className="comparison-bar comparison-bar--predicted" style={{ width: `${predictedWidth}%` }} />
                    </div>
                    <span>Pred</span>
                  </div>
                  <div className="comparison-bar-group">
                    <div className="comparison-track">
                      <div className="comparison-bar comparison-bar--actual" style={{ width: `${actualWidth}%` }} />
                    </div>
                    <span>Act</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="chart-empty">{emptyText}</p>
      )}
    </section>
  );
}

export default ComparisonChart;
