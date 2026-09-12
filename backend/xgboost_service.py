"""Service module for loading and running the campus-specific XGBoost model."""

from datetime import date, datetime, timezone
from pathlib import Path
from statistics import mean
import joblib
import pandas as pd
import xgboost as xgb
from sqlalchemy import func

from sqlalchemy.orm import Session

from models import Building, CampusUploadBatch, CampusUploadedReading, EnergyReading

import traceback

MODEL_PATH = Path(__file__).resolve().parent / "campus_energy_xgboost.pkl"
SUPPORTED_BUILDINGS = {"ADMIN", "CHEMI", "ECE"}


_xgboost_artifact = None


def get_xgboost_artifact():
    global _xgboost_artifact
    if _xgboost_artifact is None:
        if not MODEL_PATH.exists():
            print(f"ERROR: Campus XGBoost model file does not exist at path: {MODEL_PATH}")
            return None
        try:
            artifact = joblib.load(MODEL_PATH)
            if isinstance(artifact, dict) and "model" in artifact and "feature_columns" in artifact:
                _xgboost_artifact = artifact
            else:
                print(
                    f"ERROR: Invalid artifact structure in {MODEL_PATH}. "
                    f"Expected keys 'model' and 'feature_columns'. Found: {list(artifact.keys()) if isinstance(artifact, dict) else type(artifact)}"
                )
                _xgboost_artifact = None
        except Exception as exc:
            print(f"ERROR: Failed to load campus XGBoost model from {MODEL_PATH}: {exc}")
            traceback.print_exc()
            _xgboost_artifact = None
    return _xgboost_artifact



def get_xgboost_metrics() -> dict[str, float] | None:
    artifact = get_xgboost_artifact()
    if artifact and isinstance(artifact, dict) and "metrics" in artifact:
        return artifact["metrics"]
    return None


def is_supported_building(building_name: str) -> bool:
    """Check whether a building is one of the supported XGBoost college buildings (ADMIN, CHEMI, ECE)."""
    if not building_name:
        return False
    name_clean = building_name.strip().upper()
    return name_clean in SUPPORTED_BUILDINGS or any(name_clean == supported for supported in SUPPORTED_BUILDINGS)



def _history_daily_totals_for_building(
    db: Session,
    building_id: int,
    before_date: date | None = None,
    limit: int = 14,
) -> list[float]:
    """Fetch recent daily consumption totals for a building from DB history prior to before_date."""
    # 1. Try uploaded daily totals
    query = (
        db.query(
            CampusUploadBatch.batch_date,
            func.sum(CampusUploadedReading.meter_reading).label("total_kwh"),
        )
        .join(CampusUploadedReading, CampusUploadedReading.batch_id == CampusUploadBatch.id)
        .filter(CampusUploadedReading.building_id == building_id)
    )
    if before_date is not None:
        query = query.filter(CampusUploadBatch.batch_date < before_date)

    rows = (
        query.group_by(CampusUploadBatch.batch_date)
        .order_by(CampusUploadBatch.batch_date.desc())
        .limit(limit)
        .all()
    )
    if rows:
        return [round(float(r.total_kwh or 0.0), 2) for r in reversed(rows)]

    # 2. Fallback to general EnergyReading telemetry
    energy_query = (
        db.query(EnergyReading.meter_reading)
        .filter(EnergyReading.building_id == building_id)
    )
    if before_date is not None:
        cutoff = datetime.combine(before_date, datetime.min.time(), tzinfo=timezone.utc)
        energy_query = energy_query.filter(EnergyReading.recorded_at < cutoff)

    energy_rows = energy_query.order_by(EnergyReading.recorded_at.desc()).limit(limit).all()
    if energy_rows:
        return [round(float(r.meter_reading or 0.0), 2) for r in reversed(energy_rows)]

    return []


def predict_next_day_xgboost(
    db: Session,
    building: Building,
    today_total: float | None = None,
    target_date: date | None = None,
) -> float:
    """Generate next-day energy prediction for a building using saved XGBoost model."""
    if not is_supported_building(building.name):
        raise ValueError(
            "No historical data available for this building. Predictions are currently supported only for ADMIN, CHEMI, and ECE."
        )

    artifact = get_xgboost_artifact()
    if artifact is None or not isinstance(artifact, dict):
        raise RuntimeError("Campus XGBoost model artifact (campus_energy_xgboost.pkl) is not loaded.")

    model = artifact["model"]
    feature_columns = artifact["feature_columns"]

    if target_date is None:
        target_date = datetime.now(timezone.utc).date()

    # History prior to target_date (prevents data leakage)
    history = _history_daily_totals_for_building(db, building.id, before_date=target_date)

    if today_total is not None and today_total > 0:
        if not history or history[-1] != today_total:
            history.append(float(today_total))

    if not history:
        # Default baseline if no history exists prior to prediction
        history = [800.0]

    lag_1 = history[-1]
    lag_2 = history[-2] if len(history) >= 2 else lag_1

    recent_3 = history[-min(len(history), 3):]
    rolling_mean_3 = mean(recent_3) if recent_3 else lag_1

    recent_7 = history[-min(len(history), 7):]
    rolling_mean_7 = mean(recent_7) if recent_7 else lag_1

    day_of_week = target_date.weekday()
    day_of_month = target_date.day

    from academic_calendar import get_calendar_day_status
    cal_status = get_calendar_day_status(target_date)
    is_calendar_holiday = bool(cal_status and cal_status.get("is_holiday"))

    if is_calendar_holiday:
        is_weekend = 1
        effective_dow = 6.0
    else:
        is_weekend = 1 if day_of_week >= 5 else 0
        effective_dow = float(day_of_week)

    # Build feature dict matching training feature columns
    name_upper = building.name.upper()
    row_dict = {}

    for col in feature_columns:
        if col.startswith("bldg_"):
            bldg_name = col[len("bldg_"):]
            row_dict[col] = 1.0 if bldg_name.upper() in name_upper else 0.0
        elif col == "day_of_week":
            row_dict[col] = effective_dow
        elif col == "day_of_month":
            row_dict[col] = float(day_of_month)
        elif col == "is_weekend":
            row_dict[col] = float(is_weekend)
        elif col == "lag_1":
            row_dict[col] = float(lag_1)
        elif col == "lag_2":
            row_dict[col] = float(lag_2)
        elif col == "rolling_mean_3":
            row_dict[col] = float(rolling_mean_3)
        elif col == "rolling_mean_7":
            row_dict[col] = float(rolling_mean_7)
        else:
            row_dict[col] = 0.0

    X_df = pd.DataFrame([row_dict], columns=feature_columns)

    predicted = float(model.predict(X_df)[0])
    return max(round(predicted, 2), 0.0)
