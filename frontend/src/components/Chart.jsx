function Chart({ title, data }) {
  return (
    <section className="card chart-card">
      <div className="card-header">
        <div>
          <p className="card-title">{title}</p>
          <h3>Weekly load profile</h3>
        </div>
        <span className="pill">Live</span>
      </div>
      <div className="chart-bars" aria-label="Energy trend chart">
        {data.map((item) => (
          <div key={item.label} className="chart-bar-item">
            <div className="bar-track">
              <div className="bar-fill" style={{ height: `${item.value}%` }}></div>
            </div>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Chart;
