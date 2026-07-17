from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timezone
from io import BytesIO
from pathlib import Path
from statistics import mean
import hashlib
import re

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import (
    Building,
    CampusBuildingAlias,
    CampusUploadBatch,
    CampusUploadForecast,
    CampusUploadedReading,
    EnergyReading,
    Prediction,
    User,
)

SUPPORTED_SUFFIXES = {".csv", ".xlsx"}

COLUMN_ALIASES = {
    "building_name": {
        "buildingname",
        "building",
        "name",
        "building_name",
    },
    "building_id": {
        "buildingid",
        "building_id",
        "id",
    },
    "date": {
        "date",
        "readingdate",
        "reading_date",
    },
    "time": {
        "time",
        "readingtime",
        "reading_time",
    },
    "timestamp": {
        "timestamp",
        "datetime",
        "date_time",
        "readingtimestamp",
        "reading_timestamp",
    },
    "meter_reading": {
        "meterreading",
        "meter_reading",
        "meterreadingkwh",
        "kwh",
        "consumption",
        "energy",
    },
}


def _normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).strip().lower())


def _read_upload_frame(filename: str, payload: bytes) -> pd.DataFrame:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ValueError("Only CSV and XLSX uploads are supported")

    if suffix == ".csv":
        return pd.read_csv(BytesIO(payload))
    return pd.read_excel(BytesIO(payload), engine="openpyxl")


def _match_column(df: pd.DataFrame, logical_name: str) -> str | None:
    aliases = COLUMN_ALIASES[logical_name]
    for column in df.columns:
        if _normalize_header(column) in aliases:
            return column
    return None


def _to_utc_timestamp(value: pd.Timestamp) -> datetime:
    if value.tzinfo is None:
        return value.to_pydatetime().replace(tzinfo=timezone.utc)
    return value.tz_convert("UTC").to_pydatetime()


def _parse_rows(filename: str, payload: bytes) -> tuple[date, list[dict[str, object]]]:
    df = _read_upload_frame(filename, payload).dropna(how="all")
    if df.empty:
        raise ValueError("The uploaded file does not contain any rows")

    building_name_col = _match_column(df, "building_name")
    building_id_col = _match_column(df, "building_id")
    timestamp_col = _match_column(df, "timestamp")
    date_col = _match_column(df, "date")
    time_col = _match_column(df, "time")
    meter_reading_col = _match_column(df, "meter_reading")

    if meter_reading_col is None:
        raise ValueError("Upload must include a Meter Reading (kWh) column")
    if building_name_col is None and building_id_col is None:
        raise ValueError("Upload must include Building Name or Building ID")
    if timestamp_col is None and date_col is None:
        raise ValueError("Upload must include Date or Timestamp")

    working = df.copy()
    if timestamp_col is not None:
        working["_timestamp"] = pd.to_datetime(working[timestamp_col], errors="coerce")
    else:
        time_values = (
            working[time_col].fillna("00:00").astype(str)
            if time_col is not None
            else pd.Series(["00:00"] * len(working), index=working.index, dtype="string")
        )
        working["_timestamp"] = pd.to_datetime(
            working[date_col].astype(str) + " " + time_values,
            errors="coerce",
        )

    working["_meter_reading"] = pd.to_numeric(working[meter_reading_col], errors="coerce")
    if building_name_col is not None:
        working["_building_name"] = working[building_name_col].astype(str).str.strip()
    else:
        working["_building_name"] = ""
    if building_id_col is not None:
        working["_building_external_id"] = working[building_id_col].astype(str).str.strip()
    else:
        working["_building_external_id"] = None

    invalid_rows = working[
        working["_timestamp"].isna()
        | working["_meter_reading"].isna()
        | ((working["_building_name"] == "") & working["_building_external_id"].isna())
    ]
    if not invalid_rows.empty:
        first_bad = int(invalid_rows.index[0]) + 2
        raise ValueError(f"Upload contains invalid data near row {first_bad}")

    working.loc[working["_building_name"] == "", "_building_name"] = working["_building_external_id"]
    if working["_building_name"].isna().any():
        raise ValueError("Each row must contain a Building Name or Building ID")

    timestamps = working["_timestamp"].apply(_to_utc_timestamp)
    batch_dates = sorted({value.date() for value in timestamps})
    if len(batch_dates) != 1:
        raise ValueError("Upload one daily file at a time. Multiple dates were detected.")

    rows: list[dict[str, object]] = []
    for index, row in working.iterrows():
        timestamp = _to_utc_timestamp(row["_timestamp"])
        meter_reading = float(row["_meter_reading"])
        if meter_reading < 0:
            raise ValueError(f"Meter Reading must be non-negative at row {index + 2}")
        external_id = row["_building_external_id"]
        rows.append(
            {
                "building_name": str(row["_building_name"]).strip(),
                "external_building_id": str(external_id).strip() if pd.notna(external_id) and str(external_id).strip() else None,
                "reading_at": timestamp,
                "meter_reading": meter_reading,
            }
        )

    return batch_dates[0], rows


def _resolve_building(db: Session, user: User, building_name: str, external_building_id: str | None) -> Building:
    alias = None
    if external_building_id:
        alias = (
            db.query(CampusBuildingAlias)
            .filter(
                CampusBuildingAlias.user_id == user.id,
                CampusBuildingAlias.external_building_id == external_building_id,
            )
            .first()
        )
    if alias is None:
        alias = (
            db.query(CampusBuildingAlias)
            .filter(
                CampusBuildingAlias.user_id == user.id,
                func.lower(CampusBuildingAlias.external_building_name) == building_name.lower(),
            )
            .first()
        )
    if alias is not None:
        return alias.building

    building = (
        db.query(Building)
        .filter(Building.user_id == user.id, func.lower(Building.name) == building_name.lower())
        .first()
    )
    if building is None:
        building = Building(
            user_id=user.id,
            name=building_name,
            description="Imported from daily meter uploads",
            status="Active",
        )
        db.add(building)
        db.flush()

    alias = CampusBuildingAlias(
        user_id=user.id,
        building_id=building.id,
        external_building_id=external_building_id,
        external_building_name=building_name,
    )
    db.add(alias)
    db.flush()
    return building


def _daily_totals_for_batch(db: Session, batch_id: int) -> dict[int | str, dict[str, object]]:
    rows = (
        db.query(
            CampusUploadedReading.building_id,
            CampusUploadedReading.building_name,
            func.sum(CampusUploadedReading.meter_reading).label("total_kwh"),
        )
        .filter(CampusUploadedReading.batch_id == batch_id)
        .group_by(CampusUploadedReading.building_id, CampusUploadedReading.building_name)
        .all()
    )
    result: dict[int | str, dict[str, object]] = {}
    for row in rows:
        key = row.building_id if row.building_id is not None else row.building_name
        result[key] = {
            "building_id": row.building_id,
            "building_name": row.building_name,
            "total_kwh": round(float(row.total_kwh or 0.0), 2),
        }
    return result


def _history_for_building(db: Session, user_id: int, building_id: int, limit: int = 7) -> list[float]:
    rows = (
        db.query(
            CampusUploadBatch.batch_date,
            func.sum(CampusUploadedReading.meter_reading).label("total_kwh"),
        )
        .join(CampusUploadedReading, CampusUploadedReading.batch_id == CampusUploadBatch.id)
        .filter(
            CampusUploadBatch.user_id == user_id,
            CampusUploadedReading.building_id == building_id,
        )
        .group_by(CampusUploadBatch.batch_date)
        .order_by(CampusUploadBatch.batch_date.desc())
        .limit(limit)
        .all()
    )
    return [round(float(row.total_kwh or 0.0), 2) for row in reversed(rows)]


def _risk_level(predicted_energy: float) -> str:
    if predicted_energy > 1000:
        return "High"
    if predicted_energy >= 500:
        return "Medium"
    return "Low"


def _recommendation_text(predicted_energy: float) -> str:
    risk = _risk_level(predicted_energy)
    if risk == "High":
        return "Optimize HVAC schedules, stagger heavy equipment, and reduce non-essential lighting during peak hours."
    if risk == "Medium":
        return "Tune setpoints, reduce idle equipment, and shift discretionary loads to off-peak periods."
    return "Maintain current settings, review standby loads, and fine-tune lighting and ventilation schedules."


def _adjust_unrealistic_prediction(predicted_energy: float, today_total: float, history: list[float]) -> float:
    if today_total <= 0:
        return max(predicted_energy, 0.0)

    ratio = abs(predicted_energy - today_total) / today_total
    if ratio <= 0.30:
        return max(predicted_energy, 0.0)

    window = history[-min(len(history), 5):] if history else [today_total]
    recent_average = mean(window) if window else today_total

    adjusted = (today_total * 0.55) + (recent_average * 0.45)
    lower_bound = today_total * 0.70
    upper_bound = today_total * 1.30
    return max(min(adjusted, upper_bound), lower_bound)


def compute_campus_tomorrow_prediction(today_total: float, history: list[float]) -> float:
    if len(history) <= 1:
        predicted_energy = max(today_total, history[-1] if history else 0.0, 0.0)
        return round(predicted_energy, 2)

    recent_average = mean(history[-min(len(history), 5):])
    delta = history[-1] - history[-2]
    trend_projection = max(history[-1] + delta, 0.0)
    campus_projection = max((history[-1] * 0.6) + (recent_average * 0.25) + (trend_projection * 0.15), 0.0)

    stabilized = _adjust_unrealistic_prediction(campus_projection, max(today_total, 0.0), history)
    return round(stabilized, 2)


def _forecast_for_total(
    db: Session,
    building: Building,
    batch_date: date,
    today_total: float,
    model,
) -> dict[str, object]:
    latest_energy = (
        db.query(EnergyReading)
        .filter(EnergyReading.building_id == building.id)
        .order_by(EnergyReading.recorded_at.desc())
        .first()
    )
    meter = latest_energy.meter if latest_energy else 0
    _ = model
    _ = batch_date

    history = _history_for_building(db, building.owner.id, building.id)
    predicted_energy = compute_campus_tomorrow_prediction(today_total, history)
    model_source = "campus_data" if len(history) <= 1 else "campus_history+latest_upload"

    return {
        "predicted_energy": predicted_energy,
        "risk_level": _risk_level(predicted_energy),
        "recommendation": _recommendation_text(predicted_energy),
        "model_source": model_source,
        "meter": meter,
    }


def _build_comparison_rows(today_totals: dict[int | str, dict[str, object]], previous_totals: dict[int | str, dict[str, object]]) -> list[dict[str, object]]:
    high_threshold = 0.0
    if today_totals:
        high_threshold = mean(item["total_kwh"] for item in today_totals.values()) * 1.15

    rows: list[dict[str, object]] = []
    for key, current in today_totals.items():
        previous = previous_totals.get(key)
        today_total = float(current["total_kwh"])
        yesterday_total = float(previous["total_kwh"]) if previous else 0.0
        change_kwh = round(today_total - yesterday_total, 2)
        percentage_change = None
        if yesterday_total > 0:
            percentage_change = round((change_kwh / yesterday_total) * 100, 2)
        direction = "unchanged"
        if change_kwh > 0:
            direction = "increase"
        elif change_kwh < 0:
            direction = "decrease"
        rows.append(
            {
                "building_id": current["building_id"],
                "building_name": current["building_name"],
                "today_kwh": round(today_total, 2),
                "yesterday_kwh": round(yesterday_total, 2),
                "change_kwh": change_kwh,
                "percentage_change": percentage_change,
                "direction": direction,
                "high_consumption": today_total >= high_threshold if high_threshold > 0 else False,
            }
        )
    return sorted(rows, key=lambda item: (item["today_kwh"], abs(item["change_kwh"])), reverse=True)


def _history_item_from_batch(batch: CampusUploadBatch) -> dict[str, object]:
    return {
        "id": batch.id,
        "source_filename": batch.source_filename,
        "batch_date": datetime.combine(batch.batch_date, time.min, tzinfo=timezone.utc),
        "uploaded_at": batch.uploaded_at,
        "record_count": batch.record_count,
        "total_kwh": round(float(batch.total_kwh or 0.0), 2),
        "previous_total_kwh": round(float(batch.previous_total_kwh), 2) if batch.previous_total_kwh is not None else None,
        "percentage_change": round(float(batch.percentage_change), 2) if batch.percentage_change is not None else None,
        "high_consumption_count": batch.high_consumption_count,
        "comparison_ready": batch.comparison_ready,
    }


def _upload_rows_signature(rows: list[dict[str, object]]) -> str:
    normalized = []
    for row in rows:
        reading_at = row["reading_at"]
        normalized.append(
            (
                str(row["building_name"]).strip().lower(),
                (str(row["external_building_id"]).strip().lower() if row["external_building_id"] else ""),
                reading_at.isoformat(),
                f"{float(row['meter_reading']):.4f}",
            )
        )
    normalized.sort()
    digest = hashlib.sha256()
    for item in normalized:
        digest.update("|".join(item).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _batch_signature_from_db(db: Session, batch_id: int) -> str:
    readings = (
        db.query(CampusUploadedReading)
        .filter(CampusUploadedReading.batch_id == batch_id)
        .all()
    )
    rows = [
        {
            "building_name": reading.building_name,
            "external_building_id": reading.external_building_id,
            "reading_at": reading.reading_at,
            "meter_reading": reading.meter_reading,
        }
        for reading in readings
    ]
    return _upload_rows_signature(rows)


def get_upload_report_detail(db: Session, user_id: int, batch_id: int) -> dict[str, object]:
    batch = (
        db.query(CampusUploadBatch)
        .filter(CampusUploadBatch.user_id == user_id, CampusUploadBatch.id == batch_id)
        .first()
    )
    if batch is None:
        raise ValueError("Upload report not found")

    previous_batch = (
        db.query(CampusUploadBatch)
        .filter(
            CampusUploadBatch.user_id == user_id,
            CampusUploadBatch.batch_date < batch.batch_date,
        )
        .order_by(CampusUploadBatch.batch_date.desc(), CampusUploadBatch.uploaded_at.desc())
        .first()
    )
    if previous_batch is None:
        comparisons = []
    else:
        comparisons = _build_comparison_rows(
            _daily_totals_for_batch(db, batch.id),
            _daily_totals_for_batch(db, previous_batch.id),
        )
    forecasts = (
        db.query(CampusUploadForecast)
        .filter(CampusUploadForecast.batch_id == batch.id)
        .order_by(CampusUploadForecast.predicted_energy.desc(), CampusUploadForecast.building_name.asc())
        .all()
    )
    return {
        "batch": _history_item_from_batch(batch),
        "comparisons": comparisons,
        "forecasts": [
            {
                "building_id": forecast.building_id,
                "building_name": forecast.building_name,
                "predicted_energy": round(float(forecast.predicted_energy), 2),
                "risk_level": forecast.risk_level,
                "recommendation": forecast.recommendation,
                "model_source": forecast.model_source,
            }
            for forecast in forecasts
        ],
    }


def list_upload_history(db: Session, user_id: int) -> list[dict[str, object]]:
    rows = (
        db.query(CampusUploadBatch)
        .filter(CampusUploadBatch.user_id == user_id)
        .order_by(CampusUploadBatch.batch_date.desc(), CampusUploadBatch.uploaded_at.desc())
        .limit(20)
        .all()
    )
    items = [_history_item_from_batch(row) for row in rows]

    # Keep history concise by collapsing accidental duplicate uploads of the same file/day payload summary.
    unique: list[dict[str, object]] = []
    seen: set[tuple[object, ...]] = set()
    for item in items:
        key = (
            item["source_filename"],
            item["batch_date"],
            item["record_count"],
            item["total_kwh"],
            item["previous_total_kwh"],
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def get_latest_upload_report(db: Session, user_id: int) -> dict[str, object] | None:
    batch = (
        db.query(CampusUploadBatch)
        .filter(CampusUploadBatch.user_id == user_id)
        .order_by(CampusUploadBatch.batch_date.desc(), CampusUploadBatch.uploaded_at.desc())
        .first()
    )
    if batch is None:
        return None
    return get_upload_report_detail(db, user_id, batch.id)


def process_daily_upload(db: Session, user: User, filename: str, payload: bytes, model) -> dict[str, object]:
    batch_date, rows = _parse_rows(filename, payload)
    current_signature = _upload_rows_signature(rows)

    # Idempotency: if the exact same file/day payload is uploaded again, return the existing report.
    same_day_batches = (
        db.query(CampusUploadBatch)
        .filter(
            CampusUploadBatch.user_id == user.id,
            CampusUploadBatch.batch_date == batch_date,
            CampusUploadBatch.source_filename == filename,
        )
        .order_by(CampusUploadBatch.uploaded_at.desc())
        .all()
    )
    for existing_batch in same_day_batches:
        if _batch_signature_from_db(db, existing_batch.id) == current_signature:
            return get_upload_report_detail(db, user.id, existing_batch.id)

    previous_batch = (
        db.query(CampusUploadBatch)
        .filter(
            CampusUploadBatch.user_id == user.id,
            CampusUploadBatch.batch_date < batch_date,
        )
        .order_by(CampusUploadBatch.batch_date.desc(), CampusUploadBatch.uploaded_at.desc())
        .first()
    )

    batch = CampusUploadBatch(
        user_id=user.id,
        source_filename=filename,
        batch_date=batch_date,
        record_count=len(rows),
        comparison_ready=previous_batch is not None,
    )
    db.add(batch)
    db.flush()

    per_building_total: dict[int, float] = defaultdict(float)
    for row in rows:
        building = _resolve_building(db, user, row["building_name"], row["external_building_id"])
        uploaded = CampusUploadedReading(
            batch_id=batch.id,
            user_id=user.id,
            building_id=building.id,
            building_name=building.name,
            external_building_id=row["external_building_id"],
            reading_at=row["reading_at"],
            meter_reading=row["meter_reading"],
        )
        db.add(uploaded)

        latest_energy = (
            db.query(EnergyReading)
            .filter(EnergyReading.building_id == building.id)
            .order_by(EnergyReading.recorded_at.desc())
            .first()
        )
        db.add(
            EnergyReading(
                building_id=building.id,
                meter=latest_energy.meter if latest_energy else 0,
                meter_reading=row["meter_reading"],
                recorded_at=row["reading_at"],
            )
        )
        per_building_total[building.id] += float(row["meter_reading"])

    db.flush()

    today_totals = _daily_totals_for_batch(db, batch.id)
    previous_totals = _daily_totals_for_batch(db, previous_batch.id) if previous_batch is not None else {}
    comparisons = _build_comparison_rows(today_totals, previous_totals) if previous_batch is not None else []

    if previous_batch is None:
        batch.total_kwh = round(sum(float(item["total_kwh"]) for item in today_totals.values()), 2)
        batch.previous_total_kwh = None
    else:
        batch.total_kwh = round(sum(item["today_kwh"] for item in comparisons), 2)
        batch.previous_total_kwh = round(sum(item["yesterday_kwh"] for item in comparisons), 2)
    if batch.previous_total_kwh is not None and batch.previous_total_kwh > 0:
        batch.percentage_change = round(((batch.total_kwh - batch.previous_total_kwh) / batch.previous_total_kwh) * 100, 2)
    batch.high_consumption_count = sum(1 for item in comparisons if item["high_consumption"])

    forecasts: list[dict[str, object]] = []
    if today_totals:
        forecast_created_at = datetime.combine(batch_date, time(hour=12), tzinfo=timezone.utc)
        building_ids = [building_id for building_id in per_building_total]
        building_map = {
            building.id: building
            for building in db.query(Building).filter(Building.id.in_(building_ids)).all()
        }
        forecast_inputs = comparisons
        if previous_batch is None:
            forecast_inputs = [
                {
                    "building_id": value["building_id"],
                    "building_name": value["building_name"],
                    "today_kwh": value["total_kwh"],
                }
                for value in today_totals.values()
            ]
        for item in forecast_inputs:
            building_id = item["building_id"]
            if building_id is None:
                continue
            building = building_map[building_id]
            forecast = _forecast_for_total(db, building, batch_date, item["today_kwh"], model)
            db.add(
                Prediction(
                    building_id=building.id,
                    meter=int(forecast["meter"]),
                    predicted_energy=float(forecast["predicted_energy"]),
                    created_at=forecast_created_at,
                )
            )
            db.add(
                CampusUploadForecast(
                    batch_id=batch.id,
                    user_id=user.id,
                    building_id=building.id,
                    building_name=building.name,
                    predicted_energy=float(forecast["predicted_energy"]),
                    risk_level=str(forecast["risk_level"]),
                    recommendation=str(forecast["recommendation"]),
                    model_source=str(forecast["model_source"]),
                    created_at=forecast_created_at,
                )
            )
            forecasts.append(
                {
                    "building_id": building.id,
                    "building_name": building.name,
                    "predicted_energy": round(float(forecast["predicted_energy"]), 2),
                    "risk_level": str(forecast["risk_level"]),
                    "recommendation": str(forecast["recommendation"]),
                    "model_source": str(forecast["model_source"]),
                }
            )

    # Placeholder for future campus-specific retraining once enough uploaded history exists.

    db.commit()
    return {
        "batch": _history_item_from_batch(batch),
        "comparisons": comparisons,
        "forecasts": sorted(forecasts, key=lambda item: item["predicted_energy"], reverse=True),
    }


def _remove_upload_linked_energy_rows(db: Session, rows: list[CampusUploadedReading]) -> int:
    removed = 0
    for reading in rows:
        if reading.building_id is None:
            continue
        removed += (
            db.query(EnergyReading)
            .filter(
                EnergyReading.building_id == reading.building_id,
                EnergyReading.recorded_at == reading.reading_at,
                EnergyReading.meter_reading == reading.meter_reading,
            )
            .delete(synchronize_session=False)
        )
    return removed


def _remove_upload_linked_prediction_rows(db: Session, rows: list[CampusUploadForecast]) -> int:
    removed = 0
    for forecast in rows:
        if forecast.building_id is None:
            continue
        removed += (
            db.query(Prediction)
            .filter(
                Prediction.building_id == forecast.building_id,
                Prediction.created_at == forecast.created_at,
                Prediction.predicted_energy == forecast.predicted_energy,
            )
            .delete(synchronize_session=False)
        )
    return removed


def delete_upload_history_item(db: Session, user_id: int, batch_id: int) -> dict[str, object]:
    batch = (
        db.query(CampusUploadBatch)
        .filter(CampusUploadBatch.user_id == user_id, CampusUploadBatch.id == batch_id)
        .first()
    )
    if batch is None:
        raise ValueError("Upload report not found")

    readings = (
        db.query(CampusUploadedReading)
        .filter(CampusUploadedReading.batch_id == batch.id)
        .all()
    )
    forecasts = (
        db.query(CampusUploadForecast)
        .filter(CampusUploadForecast.batch_id == batch.id)
        .all()
    )

    removed_energy = _remove_upload_linked_energy_rows(db, readings)
    removed_predictions = _remove_upload_linked_prediction_rows(db, forecasts)

    db.delete(batch)
    db.commit()

    return {
        "deleted_batch_id": batch_id,
        "removed_uploaded_rows": len(readings),
        "removed_forecast_rows": len(forecasts),
        "removed_energy_rows": removed_energy,
        "removed_prediction_rows": removed_predictions,
    }


def clear_upload_history(db: Session, user: User) -> dict[str, object]:
    batches = (
        db.query(CampusUploadBatch)
        .filter(CampusUploadBatch.user_id == user.id)
        .all()
    )
    batch_ids = [batch.id for batch in batches]

    readings = (
        db.query(CampusUploadedReading)
        .filter(CampusUploadedReading.user_id == user.id)
        .all()
    )
    forecasts = (
        db.query(CampusUploadForecast)
        .filter(CampusUploadForecast.user_id == user.id)
        .all()
    )

    removed_energy = _remove_upload_linked_energy_rows(db, readings)
    removed_upload_predictions = _remove_upload_linked_prediction_rows(db, forecasts)

    building_ids = [building.id for building in user.buildings]
    removed_prediction_history = 0
    if building_ids:
        removed_prediction_history = (
            db.query(Prediction)
            .filter(Prediction.building_id.in_(building_ids))
            .delete(synchronize_session=False)
        )

    removed_forecast_rows = 0
    if batch_ids:
        removed_forecast_rows = (
            db.query(CampusUploadForecast)
            .filter(CampusUploadForecast.batch_id.in_(batch_ids))
            .delete(synchronize_session=False)
        )

    removed_uploaded_rows_db = 0
    if batch_ids:
        removed_uploaded_rows_db = (
            db.query(CampusUploadedReading)
            .filter(CampusUploadedReading.batch_id.in_(batch_ids))
            .delete(synchronize_session=False)
        )

    removed_batches = 0
    if batch_ids:
        removed_batches = (
            db.query(CampusUploadBatch)
            .filter(CampusUploadBatch.id.in_(batch_ids))
            .delete(synchronize_session=False)
        )

    db.commit()

    return {
        "removed_batches": removed_batches,
        "removed_uploaded_rows": removed_uploaded_rows_db,
        "removed_forecast_rows": removed_forecast_rows,
        "removed_energy_rows": removed_energy,
        "removed_upload_predictions": removed_upload_predictions,
        "removed_prediction_history": removed_prediction_history,
        "message": "No campus upload history found. Using ASHRAE prediction model.",
    }