from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Building, CampusUploadBatch, EnergyReading, Prediction
from schemas import AlertOut, DashboardOverview, TrendPoint
from upload_workflow import _build_comparison_rows, _daily_totals_for_batch

DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _user_buildings(db: Session, user_id: int) -> list[Building]:
    return db.query(Building).filter(Building.user_id == user_id).order_by(Building.id).all()


def _user_building_ids(db: Session, user_id: int) -> list[int]:
    return [b.id for b in _user_buildings(db, user_id)]


def _latest_readings_map(db: Session, user_id: int) -> dict[int, EnergyReading]:
    building_ids = _user_building_ids(db, user_id)
    if not building_ids:
        return {}

    subq = (
        db.query(
            EnergyReading.building_id,
            func.max(EnergyReading.recorded_at).label("max_at"),
        )
        .filter(EnergyReading.building_id.in_(building_ids))
        .group_by(EnergyReading.building_id)
        .subquery()
    )
    rows = (
        db.query(EnergyReading)
        .join(
            subq,
            (EnergyReading.building_id == subq.c.building_id)
            & (EnergyReading.recorded_at == subq.c.max_at),
        )
        .all()
    )
    return {r.building_id: r for r in rows}


def get_dashboard_overview(db: Session, user_id: int) -> DashboardOverview:
    buildings = _user_buildings(db, user_id)
    building_count = len(buildings)
    building_ids = [b.id for b in buildings]
    latest_map = _latest_readings_map(db, user_id)

    total_kwh = sum(r.meter_reading for r in latest_map.values())
    total_mwh = round(total_kwh / 1000, 2)
    avg_kwh = round(total_kwh / building_count, 1) if building_count else 0

    demand_active = sum(1 for b in buildings if b.status in ("Active", "Watch"))
    prediction_count = (
        db.query(Prediction)
        .filter(Prediction.building_id.in_(building_ids))
        .count()
        if building_ids
        else 0
    )
    last_refresh = (
        db.query(func.max(EnergyReading.recorded_at))
        .filter(EnergyReading.building_id.in_(building_ids))
        .scalar()
        if building_ids
        else None
    )

    alerts = build_alerts(db, user_id)
    open_alerts = sum(1 for a in alerts if a.status == "open")

    peak_reduction = 0.0
    if building_count >= 2:
        readings = sorted(latest_map.values(), key=lambda r: r.meter_reading, reverse=True)
        if readings[0].meter_reading > 0:
            spread = (readings[0].meter_reading - readings[-1].meter_reading) / readings[0].meter_reading
            peak_reduction = round(min(max(spread * 100, 5), 25), 1)

    return DashboardOverview(
        building_count=building_count,
        total_energy_mwh=total_mwh,
        avg_per_building_kwh=avg_kwh,
        active_alerts=open_alerts,
        demand_response_active=demand_active,
        prediction_count=prediction_count,
        peak_reduction_pct=peak_reduction,
        last_refresh=last_refresh,
        db_connected=True,
    )


def get_energy_trend(db: Session, user_id: int) -> list[TrendPoint]:
    building_ids = _user_building_ids(db, user_id)
    if not building_ids:
        return [TrendPoint(label=label, value=0) for label in DAY_LABELS]

    since = datetime.now(timezone.utc) - timedelta(days=7)
    readings = (
        db.query(EnergyReading)
        .filter(EnergyReading.building_id.in_(building_ids))
        .filter(EnergyReading.recorded_at >= since)
        .order_by(EnergyReading.recorded_at)
        .all()
    )

    buckets: dict[str, list[float]] = {label: [] for label in DAY_LABELS}
    for reading in readings:
        label = DAY_LABELS[reading.recorded_at.weekday()]
        buckets[label].append(reading.meter_reading / 100)

    trend = []
    for label in DAY_LABELS:
        values = buckets[label]
        avg = round(sum(values) / len(values), 1) if values else 0
        trend.append(TrendPoint(label=label, value=avg))

    if all(p.value == 0 for p in trend):
        latest_map = _latest_readings_map(db, user_id)
        if latest_map:
            base = sum(r.meter_reading for r in latest_map.values()) / len(latest_map) / 100
            for i, label in enumerate(DAY_LABELS):
                trend[i] = TrendPoint(label=label, value=round(base * (0.85 + (i % 3) * 0.08), 1))

    return trend


def build_alerts(db: Session, user_id: int) -> list[AlertOut]:
    buildings = _user_buildings(db, user_id)
    if not buildings:
        return []

    latest_map = _latest_readings_map(db, user_id)
    alerts: list[AlertOut] = []
    now = datetime.now(timezone.utc)

    for building in buildings:
        reading = latest_map.get(building.id)
        if not reading:
            alerts.append(
                AlertOut(
                    id=f"missing-{building.id}",
                    building_name=building.name,
                    title="Telemetry missing",
                    message="No live meter reading available for this building",
                    priority="high",
                    status="open",
                )
            )
            continue

        age_minutes = max(0, int((now - reading.recorded_at).total_seconds() // 60))
        if age_minutes > 45:
            alerts.append(
                AlertOut(
                    id=f"stale-{building.id}",
                    building_name=building.name,
                    title="Stale telemetry",
                    message=f"Latest meter reading is {age_minutes} minutes old",
                    priority="high",
                    status="open",
                )
            )

        if reading.meter_reading > 14000:
            alerts.append(
                AlertOut(
                    id=f"spike-{building.id}",
                    building_name=building.name,
                    title="High consumption",
                    message=f"Live meter reading {reading.meter_reading:.0f} kWh exceeds threshold",
                    priority="high",
                    status="open",
                )
            )
        elif reading.meter_reading > 12000:
            alerts.append(
                AlertOut(
                    id=f"watch-load-{building.id}",
                    building_name=building.name,
                    title="Rising load",
                    message=f"Live meter reading {reading.meter_reading:.0f} kWh is approaching high-load threshold",
                    priority="info",
                    status="open",
                )
            )

        if building.status == "Watch":
            alerts.append(
                AlertOut(
                    id=f"watch-{building.id}",
                    building_name=building.name,
                    title="Monitoring required",
                    message=building.description or "Building is currently in watch status",
                    priority="info",
                    status="open",
                )
            )

    latest_batch = (
        db.query(CampusUploadBatch)
        .filter(CampusUploadBatch.user_id == user_id)
        .order_by(CampusUploadBatch.batch_date.desc(), CampusUploadBatch.uploaded_at.desc())
        .first()
    )
    if latest_batch is not None and latest_batch.comparison_ready:
        previous_batch = (
            db.query(CampusUploadBatch)
            .filter(
                CampusUploadBatch.user_id == user_id,
                CampusUploadBatch.batch_date < latest_batch.batch_date,
            )
            .order_by(CampusUploadBatch.batch_date.desc(), CampusUploadBatch.uploaded_at.desc())
            .first()
        )
        if previous_batch is not None:
            comparisons = _build_comparison_rows(
                _daily_totals_for_batch(db, latest_batch.id),
                _daily_totals_for_batch(db, previous_batch.id),
            )
            for item in comparisons[:5]:
                if item["high_consumption"]:
                    alerts.append(
                        AlertOut(
                            id=f"upload-high-{latest_batch.id}-{item['building_name']}",
                            building_name=item["building_name"],
                            title="High daily consumption",
                            message=f"Uploaded daily usage reached {item['today_kwh']:.0f} kWh",
                            priority="high",
                            status="open",
                        )
                    )
                if item["percentage_change"] is not None and item["percentage_change"] >= 15:
                    alerts.append(
                        AlertOut(
                            id=f"upload-rise-{latest_batch.id}-{item['building_name']}",
                            building_name=item["building_name"],
                            title="Daily usage increased",
                            message=f"Usage increased {item['percentage_change']:.1f}% versus the previous uploaded day",
                            priority="high",
                            status="open",
                        )
                    )

    if not alerts:
        alerts.append(
            AlertOut(
                id="all-clear",
                building_name="Campus",
                title="All systems normal",
                message=f"No live anomalies detected as of {now.strftime('%H:%M:%S')}",
                priority="info",
                status="acknowledged",
            )
        )

    return alerts
