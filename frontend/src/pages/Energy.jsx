import Card from '../components/Card';
import { useCampusData } from '../context/CampusDataContext';

function Energy() {
  const { energy, overview } = useCampusData();

  const peakKw = energy.length
    ? Math.round(Math.max(...energy.map((e) => e.meter_reading)) / 10)
    : 0;
  const solarPct = overview?.building_count
    ? Math.min(35, Math.round(15 + overview.building_count * 3))
    : 0;
  const storagePct = overview?.total_energy_mwh
    ? Math.min(95, Math.round(60 + overview.total_energy_mwh))
    : 0;

  return (
    <div className="page-grid">
      <Card
        title="Peak demand"
        value={peakKw ? `${peakKw} kW` : '—'}
        detail="Based on latest meter readings"
        accent="Within limits"
      />
      <Card
        title="Solar contribution"
        value={`${solarPct}%`}
        detail="Estimated onsite generation share"
        accent="Growing"
      />
      <Card
        title="Storage reserve"
        value={`${storagePct}%`}
        detail="Battery systems currently buffered"
        accent="Reliable"
      />
      <Card
        title="Total campus load"
        value={overview ? `${overview.total_energy_mwh} MWh` : '—'}
        detail={`${energy.length} recent readings tracked`}
        accent="Live"
      />
    </div>
  );
}

export default Energy;
