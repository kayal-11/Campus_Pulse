from datetime import datetime, timezone
from statistics import mean
from typing import Any

import pandas as pd


def _normalize_timestamp(value: Any) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value
    timestamp = pd.to_datetime(value).to_pydatetime()
    if timestamp.tzinfo is None:
        return timestamp.replace(tzinfo=timezone.utc)
    return timestamp


def _campus_weather_proxy(history: list[float], timestamp: datetime) -> dict[str, float]:
    baseline = mean(history[-min(len(history), 7):]) if history else 0.0
    spread = 0.0
    if len(history) > 1:
        spread = max(history[-min(len(history), 7):]) - min(history[-min(len(history), 7):])

    seasonal = 1.0 if timestamp.month in {3, 4, 5, 9, 10, 11} else 1.2
    weekday_factor = 1.0 if timestamp.weekday() < 5 else 0.85
    load_index = (baseline / 1000.0) if baseline > 0 else 0.0

    return {
        "air_temperature": 24.0 + (load_index * 0.9 * seasonal),
        "cloud_coverage": min(max((spread / 800.0) * weekday_factor, 0.0), 1.0),
        "dew_temperature": 16.0 + (load_index * 0.35),
        "precip_depth_1_hr": 0.0,
        "sea_level_pressure": 1012.0 - min(load_index * 1.5, 10.0),
        "wind_speed": 2.5 + min(spread / 1200.0, 4.0),
    }


def build_feature_row(
    building_id: int,
    meter: int,
    recorded_at: Any | None = None,
    campus_history: list[float] | None = None,
    inventory: dict[str, float] | None = None,
) -> pd.DataFrame:
    timestamp = _normalize_timestamp(recorded_at)
    history = [max(float(v), 0.0) for v in (campus_history or [])]
    inv = inventory or {}

    lights = max(float(inv.get("lights", 0) or 0), 0.0)
    fans = max(float(inv.get("fans", 0) or 0), 0.0)
    ac_units = max(float(inv.get("ac_units", 0) or 0), 0.0)
    computers = max(float(inv.get("computers", 0) or 0), 0.0)
    lab_equipment = max(float(inv.get("lab_equipment", 0) or 0), 0.0)

    square_feet = (lights * 12.0) + (fans * 28.0) + (ac_units * 160.0) + (computers * 20.0) + (lab_equipment * 90.0)
    floor_count = max(1.0, round((lights + fans + ac_units + computers + lab_equipment) / 110.0, 1))
    year_built = float(max(1980, timestamp.year - int(min(max(building_id % 35, 5), 30))))

    weather = _campus_weather_proxy(history, timestamp)
    features = {
        "building_id": int(building_id),
        "meter": int(meter),
        "primary_use": "Education",
        "square_feet": square_feet,
        "year_built": year_built,
        "floor_count": floor_count,
        "hour": int(timestamp.hour),
        "day_of_week": int(timestamp.weekday()),
        "month": int(timestamp.month),
        "is_weekend": int(timestamp.weekday() >= 5),
        **weather,
    }
    return pd.DataFrame([features])
