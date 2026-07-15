import { useCampusData } from '../context/CampusDataContext';

const navItems = ['Home', 'Dashboard', 'Energy', 'Buildings', 'Analytics', 'Prediction', 'Alerts', 'Admin', 'Settings'];

const iconMap = {
  Home: '◉',
  Dashboard: '▣',
  Energy: '⚡',
  Buildings: '⌂',
  Analytics: '◔',
  Prediction: '✦',
  Alerts: '⚑',
  Admin: '◎',
  Settings: '⚙',
};

function Sidebar({ activeItem, onSelect }) {
  const { liveStatus, alerts } = useCampusData();

  const openAlerts = alerts.filter((alert) => String(alert.status || '').toLowerCase() === 'open');
  const highAlerts = openAlerts.filter((alert) => {
    const priority = String(alert.priority || '').toLowerCase();
    return priority === 'high' || priority === 'critical';
  }).length;
  const infoAlerts = Math.max(0, openAlerts.length - highAlerts);

  const connectionPenalty = liveStatus === 'offline' ? 10 : liveStatus === 'connecting' ? 5 : 0;
  const rawHealthScore = 100 - (highAlerts * 8) - (infoAlerts * 2) - connectionPenalty;
  const healthScore = Math.max(70, Math.min(100, rawHealthScore));

  const healthLabel = liveStatus !== 'live'
    ? 'Syncing'
    : highAlerts > 0
      ? 'Critical'
      : openAlerts.length > 0
        ? 'Watch'
        : 'Stable';

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">⚡</div>
        <div>
          <h2>Campus Pulse</h2>
          <p>Energy intelligence</p>
        </div>
      </div>

      <nav className="nav-links" aria-label="Primary">
        {navItems.map((item) => (
          <button
            key={item}
            className={activeItem === item ? 'nav-link active' : 'nav-link'}
            onClick={() => onSelect(item)}
            type="button"
          >
            <span className="nav-icon">{iconMap[item]}</span>
            <span>{item}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <p>System health</p>
        <strong>{`${healthLabel} · ${healthScore.toFixed(1)}%`}</strong>
      </div>
    </aside>
  );
}

export default Sidebar;
