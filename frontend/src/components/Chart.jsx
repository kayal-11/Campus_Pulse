function Chart({ title, data, subtitle = 'Weekly load profile', emptyText = 'No data available yet', accent = 'Live', type = 'bar' }) {
  const safeData = Array.isArray(data) ? data.filter((item) => item && item.label) : [];
  const maxValue = safeData.reduce((max, item) => Math.max(max, Number(item.value) || 0), 0);
  const totalValue = safeData.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);

  const renderBars = () => (
    <div className="chart-bars" aria-label={`${title} chart`}>
      {safeData.map((item) => {
        const value = Number(item.value) || 0;
        const height = maxValue > 0 ? Math.max(8, (value / maxValue) * 100) : 0;
        return (
          <div key={item.label} className="chart-bar-item">
            <div className="bar-track">
              <div className="bar-fill" style={{ height: `${height}%` }}></div>
            </div>
            <div className="chart-label-group">
              <span>{item.label}</span>
              <small>{value.toFixed(0)}</small>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderLine = () => {
    const points = safeData.map((item, index) => {
      const value = Number(item.value) || 0;
      const x = safeData.length > 1 ? (index / (safeData.length - 1)) * 100 : 50;
      const y = maxValue > 0 ? 100 - (value / maxValue) * 80 - 10 : 90;
      return `${x},${y}`;
    });

    return (
      <div className="line-chart-wrapper">
        <svg className="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${title} line chart`}>
          <polyline points={points.join(' ')} />
          {safeData.map((item, index) => {
            const value = Number(item.value) || 0;
            const x = safeData.length > 1 ? (index / (safeData.length - 1)) * 100 : 50;
            const y = maxValue > 0 ? 100 - (value / maxValue) * 80 - 10 : 90;
            return <circle key={`${item.label}-${index}`} cx={x} cy={y} r="2.2" />;
          })}
        </svg>
        <div className="chart-label-row">
          {safeData.map((item) => (
            <span key={item.label}>{item.label}</span>
          ))}
        </div>
      </div>
    );
  };

  const renderDistribution = () => {
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    return (
      <div className="distribution-chart">
        <svg className="distribution-chart-svg" viewBox="0 0 120 120" aria-label={`${title} distribution chart`}>
          <circle cx="60" cy="60" r={radius} className="distribution-base" />
          {safeData.map((item) => {
            const value = Math.max(0, Number(item.value) || 0);
            const sliceLength = totalValue > 0 ? (value / totalValue) * circumference : 0;
            const dash = `${sliceLength} ${circumference - sliceLength}`;
            const circle = (
              <circle
                key={item.label}
                cx="60"
                cy="60"
                r={radius}
                className="distribution-slice"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            );
            offset += sliceLength;
            return circle;
          })}
        </svg>
        <ul className="distribution-legend">
          {safeData.map((item) => (
            <li key={item.label}>
              <span className="legend-dot" />
              <strong>{item.label}</strong>
              <span>{Number(item.value || 0).toFixed(0)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

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
        <>
          {type === 'line' && renderLine()}
          {type === 'distribution' && renderDistribution()}
          {type !== 'line' && type !== 'distribution' && renderBars()}
        </>
      ) : (
        <p className="chart-empty">{emptyText}</p>
      )}
    </section>
  );
}

export default Chart;
