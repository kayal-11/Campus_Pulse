from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
BUILDING_METADATA_PATH = BASE_DIR / "dataset" / "building_metadata.feather"
WEATHER_PATH = BASE_DIR / "dataset" / "weather_train.feather"

WEATHER_COLUMNS = [
    "air_temperature",
    "cloud_coverage",
    "dew_temperature",
    "precip_depth_1_hr",
    "sea_level_pressure",
    "wind_speed",
]

_building_metadata: pd.DataFrame | None = None
_weather_lookup: dict[tuple[int, datetime], dict[str, Any]] | None = None
_site_weather_mean: pd.DataFrame | None = None
_global_weather_mean: pd.Series | None = None


def _load_building_metadata() -> pd.DataFrame:
    global _building_metadata
    if _building_metadata is None:
        df = pd.read_feather(BUILDING_METADATA_PATH)
        df["primary_use"] = df["primary_use"].fillna("Unknown")
        df["square_feet"] = df["square_feet"].fillna(df["square_feet"].median())
        df["year_built"] = df["year_built"].fillna(df["year_built"].median())
        df["floor_count"] = df["floor_count"].fillna(-1)
        _building_metadata = df.set_index("building_id")
    return _building_metadata


def _load_weather_data() -> None:
    global _weather_lookup, _site_weather_mean, _global_weather_mean
    if _weather_lookup is None:
        df = pd.read_feather(WEATHER_PATH)
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df["cloud_coverage"] = df["cloud_coverage"].fillna(0.0)
        df["precip_depth_1_hr"] = df["precip_depth_1_hr"].fillna(0.0)
        df["wind_speed"] = df["wind_speed"].fillna(0.0)
        df["air_temperature"] = df["air_temperature"].fillna(df["air_temperature"].median())
        df["dew_temperature"] = df["dew_temperature"].fillna(df["dew_temperature"].median())
        df["sea_level_pressure"] = df["sea_level_pressure"].fillna(df["sea_level_pressure"].median())

        _weather_lookup = {
            (int(row.site_id), row.timestamp): {
                col: float(row._asdict()[col]) for col in WEATHER_COLUMNS
            }
            for row in df.itertuples(index=False)
        }
        _site_weather_mean = df.groupby("site_id")[WEATHER_COLUMNS].mean()
        _global_weather_mean = df[WEATHER_COLUMNS].mean()


def _normalize_timestamp(value: Any) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value
    return pd.to_datetime(value).to_pydatetime()


def _get_weather_features(site_id: int, timestamp: datetime) -> dict[str, float]:
    _load_weather_data()
    timestamp = timestamp.replace(minute=0, second=0, microsecond=0)
    if _weather_lookup is None:
        raise RuntimeError("Weather data unavailable")

    key = (site_id, timestamp)
    if key in _weather_lookup:
        return _weather_lookup[key]

    if _site_weather_mean is not None and site_id in _site_weather_mean.index:
        return {col: float(_site_weather_mean.loc[site_id, col]) for col in WEATHER_COLUMNS}

    if _global_weather_mean is not None:
        return {col: float(_global_weather_mean[col]) for col in WEATHER_COLUMNS}

    return {col: 0.0 for col in WEATHER_COLUMNS}


def build_feature_row(building_id: int, meter: int, recorded_at: Any | None = None) -> pd.DataFrame:
    metadata = _load_building_metadata()
    timestamp = _normalize_timestamp(recorded_at)

    if building_id in metadata.index:
        row = metadata.loc[building_id]
        site_id = int(row["site_id"])
        primary_use = str(row["primary_use"])
        square_feet = float(row["square_feet"])
        year_built = float(row["year_built"])
        floor_count = float(row["floor_count"])
    else:
        site_id = 0
        primary_use = "Unknown"
        square_feet = 0.0
        year_built = 0.0
        floor_count = -1.0

    weather = _get_weather_features(site_id, timestamp)
    features = {
        "building_id": int(building_id),
        "meter": int(meter),
        "primary_use": primary_use,
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
