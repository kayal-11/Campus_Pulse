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
        <strong>Stable · 99.2%</strong>
      </div>
    </aside>
  );
}

export default Sidebar;
