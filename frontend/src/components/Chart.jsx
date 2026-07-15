function Chart({
  title,
  data,
  subtitle = 'Weekly load profile',
  emptyText = 'No data available yet',
  accent = 'Live',
  type = 'bar',
  barOrientation = 'vertical',
  lineOptions = {},
}) {
  const chartPalette = ['#2563eb', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];
  const safeData = Array.isArray(data) ? data.filter((item) => item && item.label) : [];
  const maxValue = safeData.reduce((max, item) => Math.max(max, Number(item.value) || 0), 0);
  const totalValue = safeData.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);

  const polarToCartesian = (cx, cy, radius, angleInDegrees) => {
    const radians = (angleInDegrees - 90) * (Math.PI / 180);
    return {
      x: cx + radius * Math.cos(radians),
      y: cy + radius * Math.sin(radians),
    };
  };

  const buildPieSlicePath = (cx, cy, radius, startAngle, endAngle) => {
    const start = polarToCartesian(cx, cy, radius, startAngle);
    const end = polarToCartesian(cx, cy, radius, endAngle);
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
  };

  const renderBars = () => {
    if (barOrientation === 'horizontal') {
      return (
        <div className="horizontal-bars" aria-label={`${title} chart`}>
          {safeData.map((item) => {
            const value = Number(item.value) || 0;
            const width = maxValue > 0 ? Math.max(8, (value / maxValue) * 100) : 0;
            return (
              <div key={item.label} className="horizontal-bar-item">
                <div className="horizontal-bar-label">
                  <span>{item.label}</span>
                  <small>{new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}</small>
                </div>
                <div className="horizontal-bar-track">
                  <div className="horizontal-bar-fill" style={{ width: `${width}%` }}></div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
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
  };

  const renderLine = () => {
    const {
      dynamicYAxis = false,
      smooth = false,
      markerSolid = false,
      markerRadius = 2.2,
      markerColor = '#2563eb',
    } = lineOptions;

    const values = safeData.map((item) => Number(item.value) || 0);
    const minRaw = values.length ? Math.min(...values) : 0;
    const maxRaw = values.length ? Math.max(...values) : 0;
    const baseRange = maxRaw - minRaw;
    const pad = dynamicYAxis
      ? (baseRange > 0 ? baseRange * 0.12 : Math.max(1, Math.abs(maxRaw) * 0.05 || 1))
      : 0;
    const minDomain = dynamicYAxis ? minRaw - pad : 0;
    const maxDomain = dynamicYAxis ? maxRaw + pad : Math.max(maxValue, 1);
    const domainRange = Math.max(maxDomain - minDomain, 1);
    const plotTop = 10;
    const plotBottom = 90;
    const plotHeight = plotBottom - plotTop;

    const points = safeData.map((item, index) => {
      const value = Number(item.value) || 0;
      const x = safeData.length > 1 ? (index / (safeData.length - 1)) * 100 : 50;
      const y = plotBottom - ((value - minDomain) / domainRange) * plotHeight;
      return { x, y };
    });

    const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(' ');

    let smoothPath = '';
    if (points.length) {
      smoothPath = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const curr = points[i];
        const midX = (prev.x + curr.x) / 2;
        const midY = (prev.y + curr.y) / 2;
        smoothPath += ` Q ${prev.x} ${prev.y} ${midX} ${midY}`;
      }
      const last = points[points.length - 1];
      smoothPath += ` T ${last.x} ${last.y}`;
    }

    return (
      <div className="line-chart-wrapper">
        <svg className="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${title} line chart`}>
          {smooth ? <path d={smoothPath} className="line-chart__polyline" /> : <polyline points={polylinePoints} />}
          {points.map((point, index) => {
            const markerProps = markerSolid
              ? { fill: markerColor, stroke: 'none' }
              : { fill: '#38bdf8', stroke: '#ffffff', strokeWidth: 1.2 };

            return <circle key={`${safeData[index].label}-${index}`} cx={point.x} cy={point.y} r={markerRadius} style={markerProps} />;
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

  const renderPie = () => {
    let startAngle = 0;

    return (
      <div className="pie-chart-wrapper">
        <svg viewBox="0 0 120 120" className="pie-chart" aria-label={`${title} pie chart`}>
          <circle cx="60" cy="60" r="42" className="pie-chart__base" />
          {safeData.map((item, index) => {
            const value = Math.max(0, Number(item.value) || 0);
            const sweepAngle = totalValue > 0 ? (value / totalValue) * 360 : 0;
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
          {safeData.map((item, index) => {
            const value = Math.max(0, Number(item.value) || 0);
            const share = totalValue > 0 ? (value / totalValue) * 100 : 0;

            return (
              <li key={item.label}>
                <span className="legend-dot" style={{ backgroundColor: item.color || chartPalette[index % chartPalette.length] }} />
                {item.label} ({value.toFixed(1)}) - {share.toFixed(1)}%
              </li>
            );
          })}
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
          {type === 'pie' && renderPie()}
          {type === 'distribution' && renderDistribution()}
          {type !== 'line' && type !== 'distribution' && type !== 'pie' && renderBars()}
        </>
      ) : (
        <p className="chart-empty">{emptyText}</p>
      )}
    </section>
  );
}

export default Chart;
