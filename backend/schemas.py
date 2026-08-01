from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, Field


class EnergyInput(BaseModel):
    building_id: int
    meter: int


class BuildingInventoryIn(BaseModel):
    lights: int = Field(default=0, ge=0)
    fans: int = Field(default=0, ge=0)
    ac_units: int = Field(default=0, ge=0)
    computers: int = Field(default=0, ge=0)
    lab_equipment: int = Field(default=0, ge=0)


class BuildingCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    status: str = "Active"
    inventory: Optional[BuildingInventoryIn] = None
    initial_date: date
    initial_time: time
    initial_meter_reading: float = Field(..., ge=0)


class BuildingInventoryOut(BaseModel):
    building_id: int
    lights: int
    fans: int
    ac_units: int
    computers: int
    lab_equipment: int

    model_config = {"from_attributes": True}


class BuildingOut(BaseModel):
    id: int
    name: str
    description: str
    status: str
    created_at: datetime
    latest_reading: Optional[float] = None

    model_config = {"from_attributes": True}


class EnergyReadingOut(BaseModel):
    id: int
    building_id: int
    building_name: str
    meter: int
    meter_reading: float
    recorded_at: datetime

    model_config = {"from_attributes": True}


class PredictionOut(BaseModel):
    id: int
    building_id: int
    building_name: str
    meter: int
    predicted_energy: float
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminStats(BaseModel):
    building_count: int
    total_energy_mwh: float
    prediction_count: int
    last_refresh: Optional[datetime] = None
    db_connected: bool = True


class UserSignup(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=6, max_length=128)


class UserLogin(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class DashboardOverview(BaseModel):
    building_count: int
    total_energy_mwh: float
    avg_per_building_kwh: float
    active_alerts: int
    demand_response_active: int
    prediction_count: int
    peak_reduction_pct: float
    last_refresh: Optional[datetime] = None
    db_connected: bool = True


class TrendPoint(BaseModel):
    label: str
    value: float


class AlertOut(BaseModel):
    id: str
    building_name: str
    title: str
    message: str
    priority: str
    status: str


class CampusUploadComparisonOut(BaseModel):
    building_id: Optional[int] = None
    building_name: str
    today_kwh: float
    yesterday_kwh: float
    change_kwh: float
    percentage_change: Optional[float] = None
    direction: str
    high_consumption: bool = False


class CampusUploadForecastOut(BaseModel):
    building_id: Optional[int] = None
    building_name: str
    predicted_energy: float
    risk_level: str
    recommendation: str
    model_source: str


class CampusUploadHistoryItemOut(BaseModel):
    id: int
    source_filename: str
    batch_date: datetime
    uploaded_at: datetime
    record_count: int
    total_kwh: float
    previous_total_kwh: Optional[float] = None
    percentage_change: Optional[float] = None
    high_consumption_count: int
    comparison_ready: bool


class CampusUploadReportOut(BaseModel):
    batch: CampusUploadHistoryItemOut
    comparisons: list[CampusUploadComparisonOut]
    forecasts: list[CampusUploadForecastOut]
