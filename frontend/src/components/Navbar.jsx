import { useAuth } from '../context/AuthContext';
import { useCampusData } from '../context/CampusDataContext';
import { exportReport } from '../services/api';

function Navbar({ title }) {
  const { user, logout } = useAuth();
  const { liveStatus } = useCampusData();

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'U';

  const handleExport = async () => {
    try {
      await exportReport();
    } catch {
      /* silent */
    }
  };

  return (
    <header className="navbar">
      <div>
        <p className="eyebrow">
          Operations center
          <span className={`nav-live nav-live--${liveStatus}`}>
            {liveStatus === 'live' ? ' ● Live' : ''}
          </span>
        </p>
        <h1>{title}</h1>
      </div>

      <div className="navbar-actions">
        <label className="search-box" htmlFor="search">
          <span>⌕</span>
          <input id="search" type="text" placeholder="Search assets" />
        </label>
        <button className="ghost-btn" type="button" onClick={handleExport}>
          Export
        </button>
        <div className="profile-pill">
          <span className="avatar">{initials}</span>
          <div>
            <strong>{user?.name}</strong>
            <p>{user?.role || 'Operator'}</p>
          </div>
        </div>
        <button className="logout-btn" type="button" onClick={logout}>
          Logout
        </button>
      </div>
    </header>
  );
}

export default Navbar;
