import { useEffect, useState, useMemo } from 'react';
import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes threshold

function formatStaleDuration(recordedAt, nowTime) {
  if (!recordedAt) return 'No meter data available';
  const diffMs = Math.max(0, nowTime - new Date(recordedAt).getTime());
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return 'Latest meter reading is less than a minute old';
  }

  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) {
    return `Latest meter reading is ${minutes} minute${minutes !== 1 ? 's' : ''} old`;
  }

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    if (remMinutes === 0) {
      return `Latest meter reading is ${hours} hour${hours !== 1 ? 's' : ''} old`;
    }
    return `Latest meter reading is ${hours} hour${hours !== 1 ? 's' : ''} ${remMinutes} minute${remMinutes !== 1 ? 's' : ''} old`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (remHours === 0) {
    return `Latest meter reading is ${days} day${days !== 1 ? 's' : ''} old`;
  }
  return `Latest meter reading is ${days} day${days !== 1 ? 's' : ''} ${remHours} hour${remHours !== 1 ? 's' : ''} old`;
}

function Alerts() {
  const { alerts } = useCampusData();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const processedAlerts = useMemo(() => {
    return alerts.map((a) => {
      const isStaleAlert =
        a.id.startsWith('stale-') ||
        a.id.startsWith('missing-') ||
        a.title === 'Stale telemetry' ||
        a.title === 'Telemetry missing';

      if (isStaleAlert) {
        if (!a.recorded_at) {
          return {
            ...a,
            title: 'Telemetry missing',
            message: 'No meter data available',
            status: 'open',
            priority: 'high',
          };
        }

        const ageMs = Math.max(0, now - new Date(a.recorded_at).getTime());
        const isStale = ageMs > STALE_THRESHOLD_MS;

        return {
          ...a,
          title: 'Stale telemetry',
          message: formatStaleDuration(a.recorded_at, now),
          status: isStale ? 'open' : 'resolved',
          priority: isStale ? 'high' : 'info',
        };
      }

      return a;
    });
  }, [alerts, now]);

  const open = processedAlerts.filter((a) => a.status === 'open');
  const high = open.filter((a) => a.priority === 'high');
  const info = open.filter((a) => a.priority === 'info');
  const acknowledged = processedAlerts.filter((a) => a.status === 'acknowledged' || a.status === 'resolved');

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

      {processedAlerts.length > 0 && (
        <section className="alerts-list">
          <h3>All alerts</h3>
          <ul>
            {processedAlerts.map((a) => (
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
