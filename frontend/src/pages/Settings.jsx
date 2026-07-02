import Card from '../components/Card';
import { useAuth } from '../context/AuthContext';
import { useCampusData } from '../context/CampusDataContext';

function Settings() {
  const { user } = useAuth();
  const { liveStatus, overview } = useCampusData();

  return (
    <div className="page-grid">
      <Card
        title="Account"
        value={user?.name || '—'}
        detail={user?.email}
        accent={user?.role || 'Operator'}
      />
      <Card
        title="Notifications"
        value="Enabled"
        detail={`${overview?.active_alerts ?? 0} active alert thresholds`}
        accent="Active"
      />
      <Card
        title="Data sync"
        value={liveStatus === 'live' ? 'Real-time' : 'Polling'}
        detail={overview?.last_refresh
          ? `Last sync ${new Date(overview.last_refresh).toLocaleString()}`
          : 'Waiting for data'}
        accent={liveStatus === 'live' ? 'Healthy' : 'Syncing'}
      />
    </div>
  );
}

export default Settings;
