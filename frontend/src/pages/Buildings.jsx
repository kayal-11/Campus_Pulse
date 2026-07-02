import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';

function Buildings() {
  const { buildings } = useCampusData();

  if (!buildings.length) {
    return (
      <div className="page-empty">
        <p>No buildings found. Add one from the Admin panel.</p>
      </div>
    );
  }

  return (
    <div className="page-grid">
      {buildings.map((b) => (
        <Card
          key={b.id}
          title={b.name}
          value={b.latest_reading ? `${(b.latest_reading / 1000).toFixed(1)} MWh` : '—'}
          detail={b.description || 'No description'}
          accent={b.status}
        />
      ))}
    </div>
  );
}

export default Buildings;
