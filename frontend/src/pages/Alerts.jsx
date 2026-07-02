import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';

function Alerts() {
  const { alerts } = useCampusData();

  const open = alerts.filter((a) => a.status === 'open');
  const high = open.filter((a) => a.priority === 'high');
  const info = open.filter((a) => a.priority === 'info');
  const acknowledged = alerts.filter((a) => a.status === 'acknowledged');

  return (
    <>
      <div className="page-grid">
        <Card
          title="Open alerts"
          value={String(open.length)}
          detail={`${high.length} high priority, ${info.length} informational`}
          accent={open.length ? 'Needs attention' : 'All clear'}
        />
        <Card
          title="Escalation"
          value={String(high.length)}
          detail={high.length ? high[0]?.message : 'No escalations'}
          accent={high.length ? 'Action required' : 'Stable'}
        />
        <Card
          title="Acknowledged"
          value={String(acknowledged.length)}
          detail="Resolved within SLA"
          accent="Stable"
        />
      </div>

      {alerts.length > 0 && (
        <section className="alerts-list">
          <h3>All alerts</h3>
          <ul>
            {alerts.map((a) => (
              <li key={a.id} className={`alert-item alert-item--${a.priority}`}>
                <div>
                  <strong>{a.title}</strong>
                  <span>{a.building_name}</span>
                  <p>{a.message}</p>
                </div>
                <span className="pill">{a.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default Alerts;
