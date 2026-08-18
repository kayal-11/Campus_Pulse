import csv
import io
import os
import random
from datetime import date, datetime, timedelta, timezone

from pathlib import Path

import joblib
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import create_access_token, get_current_user, hash_password, verify_password
from database import get_db
from init_db import init_database
from models import Building, BuildingCustomDevice, BuildingDeviceConfig, BuildingInventory, CampusUploadBatch, CampusUploadedReading, EnergyReading, Prediction, User
from realtime import manager
from schemas import (
    AdminStats,
    AlertOut,
    AuthResponse,
    BuildingCreate,
    BuildingDeviceConfigIn,
    BuildingDeviceConfigOut,
    BuildingInventoryIn,
    BuildingInventoryOut,
    BuildingOut,
    CampusUploadHistoryItemOut,
    CampusUploadReportOut,
    CustomDeviceCreate,
    CustomDeviceOut,
    CustomDeviceUpdate,
    DashboardOverview,
    EnergyInput,
    EnergyReadingOut,
    ManualMeterReadingIn,
    PredictionOut,
    TrendPoint,
    UserLogin,
    UserOut,
    UserSignup,
)
from services import build_alerts, get_dashboard_overview, get_energy_trend
from feature_utils import build_feature_row
from upload_workflow import (
    clear_upload_history,
    compute_campus_tomorrow_prediction,
    delete_upload_history_item,
    get_latest_upload_report,
    get_upload_report_detail,
    list_upload_history,
    process_daily_upload,
)
from xgboost_service import get_xgboost_artifact, get_xgboost_metrics, is_supported_building, predict_next_day_xgboost

load_dotenv(Path(__file__).resolve().parent.parent / ".env")




app = FastAPI(title="Campus Energy AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None
MODEL_PATH = Path(__file__).parent / "energy_model.pkl"


def get_model():
    global _model
    if _model is None and MODEL_PATH.exists():
        _model = joblib.load(MODEL_PATH)
    return _model


def _campus_history_for_building(db: Session, building_id: int, limit: int = 30) -> list[float]:
    rows = (
        db.query(EnergyReading.meter_reading)
        .filter(EnergyReading.building_id == building_id)
        .order_by(EnergyReading.recorded_at.desc())
        .limit(limit)
        .all()
    )
    return [float(row.meter_reading or 0.0) for row in reversed(rows)]


def _inventory_features_for_building(db: Session, building_id: int) -> dict[str, float]:
    inventory = db.query(BuildingInventory).filter(BuildingInventory.building_id == building_id).first()
    if inventory is None:
        return {
            "lights": 0.0,
            "fans": 0.0,
            "ac_units": 0.0,
            "computers": 0.0,
            "lab_equipment": 0.0,
        }
    return {
        "lights": float(inventory.lights or 0),
        "fans": float(inventory.fans or 0),
        "ac_units": float(inventory.ac_units or 0),
        "computers": float(inventory.computers or 0),
        "lab_equipment": float(inventory.lab_equipment or 0),
    }


@app.on_event("startup")
def on_startup():
    init_database()
    artifact = get_xgboost_artifact()
    if artifact and isinstance(artifact, dict) and "model" in artifact and "feature_columns" in artifact:
        print(f"INFO: Campus XGBoost prediction model loaded successfully at startup.")
    else:
        print(f"ERROR: Campus XGBoost model (campus_energy_xgboost.pkl) failed to load at startup.")




# ── Existing endpoints (unchanged contract) ──────────────────────────────────

@app.get("/")
def home():
    return {"message": "Campus Energy Optimization API is running!"}


@app.post("/predict")
def predict(data: EnergyInput, db: Session = Depends(get_db)):
    model = get_model()
    if model is None:
        raise HTTPException(status_code=503, detail="AI model not trained yet. Run ai/train_model.py first.")
    history = _campus_history_for_building(db, data.building_id)
    inventory = _inventory_features_for_building(db, data.building_id)
    latest = (
        db.query(EnergyReading)
        .filter(EnergyReading.building_id == data.building_id)
        .order_by(EnergyReading.recorded_at.desc())
        .first()
    )
    feature_df = build_feature_row(
        data.building_id,
        data.meter,
        latest.recorded_at if latest else None,
        history,
        inventory,
    )
    prediction = model.predict(feature_df)
    return {
        "building_id": data.building_id,
        "meter": data.meter,
        "predicted_energy": float(prediction[0]),
    }


# ── Auth API ─────────────────────────────────────────────────────────────────

@app.post("/api/auth/signup", response_model=AuthResponse, status_code=201)
def signup(payload: UserSignup, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email.lower()).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        name=payload.name.strip(),
        email=payload.email.lower().strip(),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id, user.email)
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@app.post("/api/auth/signin", response_model=AuthResponse)
def signin(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower().strip()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user.id, user.email)
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@app.get("/api/auth/me", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


# ── Dashboard API ────────────────────────────────────────────────────────────

@app.get("/api/dashboard/overview", response_model=DashboardOverview)
def dashboard_overview(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    try:
        return get_dashboard_overview(db, _user.id)
    except Exception:
        return DashboardOverview(
            building_count=0,
            total_energy_mwh=0,
            avg_per_building_kwh=0,
            active_alerts=0,
            demand_response_active=0,
            prediction_count=0,
            peak_reduction_pct=0,
            last_refresh=None,
            db_connected=False,
        )


@app.get("/api/dashboard/trend", response_model=list[TrendPoint])
def dashboard_trend(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    try:
        return get_energy_trend(db, _user.id)
    except Exception:
        return [TrendPoint(label=d, value=0) for d in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]]


@app.get("/api/alerts", response_model=list[AlertOut])
def list_alerts(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    try:
        return build_alerts(db, _user.id)
    except Exception:
        return []


# ── Real-time WebSocket ──────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ── Buildings API ────────────────────────────────────────────────────────────

def _building_out(building: Building, db: Session) -> BuildingOut:
    latest = (
        db.query(EnergyReading)
        .filter(EnergyReading.building_id == building.id)
        .order_by(EnergyReading.recorded_at.desc())
        .first()
    )
    return BuildingOut(
        id=building.id,
        name=building.name,
        description=building.description,
        status=building.status,
        created_at=building.created_at,
        latest_reading=latest.meter_reading if latest else None,
    )


def _inventory_out(inventory: BuildingInventory | None, building_id: int) -> BuildingInventoryOut:
    if inventory is None:
        return BuildingInventoryOut(
            building_id=building_id,
            lights=0,
            fans=0,
            ac_units=0,
            computers=0,
            lab_equipment=0,
        )
    return BuildingInventoryOut.model_validate(inventory)


def _device_config_out(config: BuildingDeviceConfig | None, building_id: int) -> BuildingDeviceConfigOut:
    if config is None:
        return BuildingDeviceConfigOut(
            building_id=building_id,
            lights_wattage=20,
            lights_hours=11,
            fans_wattage=75,
            fans_hours=10,
            acs_wattage=1500,
            acs_hours=8,
            computers_wattage=140,
            computers_hours=9,
            lab_wattage=900,
            lab_hours=7,
        )
    return BuildingDeviceConfigOut.model_validate(config)


@app.get("/api/buildings", response_model=list[BuildingOut])
def list_buildings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    buildings = db.query(Building).filter(Building.user_id == user.id).order_by(Building.id).all()
    return [_building_out(b, db) for b in buildings]


@app.post("/api/buildings", response_model=BuildingOut, status_code=201)
async def add_building(
    payload: BuildingCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = Building(
        user_id=user.id,
        name=payload.name,
        description=payload.description,
        status=payload.status,
    )
    db.add(building)
    db.flush()
    inv = payload.inventory or BuildingInventoryIn()
    db.add(
        BuildingInventory(
            building_id=building.id,
            lights=inv.lights,
            fans=inv.fans,
            ac_units=inv.ac_units,
            computers=inv.computers,
            lab_equipment=inv.lab_equipment,
        )
    )
    reading_at = datetime.combine(payload.initial_date, payload.initial_time).replace(tzinfo=timezone.utc)
    db.add(
        EnergyReading(
            building_id=building.id,
            meter=0,
            meter_reading=round(float(payload.initial_meter_reading), 2),
            recorded_at=reading_at,
        )
    )
    db.commit()
    db.refresh(building)
    result = _building_out(building, db)
    await manager.broadcast("building_added", result.model_dump(mode="json"))
    return result


@app.delete("/api/buildings/{building_id}", status_code=204)
async def delete_building(
    building_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = (
        db.query(Building)
        .filter(Building.id == building_id, Building.user_id == user.id)
        .first()
    )
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    db.delete(building)
    db.commit()
    await manager.broadcast("building_removed", {"building_id": building_id})


@app.get("/api/buildings/{building_id}/inventory", response_model=BuildingInventoryOut)
def get_building_inventory(
    building_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = (
        db.query(Building)
        .filter(Building.id == building_id, Building.user_id == user.id)
        .first()
    )
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    inventory = db.query(BuildingInventory).filter(BuildingInventory.building_id == building.id).first()
    return _inventory_out(inventory, building.id)


@app.put("/api/buildings/{building_id}/inventory", response_model=BuildingInventoryOut)
async def update_building_inventory(
    building_id: int,
    payload: BuildingInventoryIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = (
        db.query(Building)
        .filter(Building.id == building_id, Building.user_id == user.id)
        .first()
    )
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    inventory = db.query(BuildingInventory).filter(BuildingInventory.building_id == building.id).first()
    if inventory is None:
        inventory = BuildingInventory(building_id=building.id)
        db.add(inventory)

    inventory.lights = payload.lights
    inventory.fans = payload.fans
    inventory.ac_units = payload.ac_units
    inventory.computers = payload.computers
    inventory.lab_equipment = payload.lab_equipment

    db.commit()
    db.refresh(inventory)
    res = BuildingInventoryOut.model_validate(inventory)
    await manager.broadcast("inventory_updated", {"building_id": building_id})
    return res


@app.get("/api/buildings/{building_id}/device-config", response_model=BuildingDeviceConfigOut)
def get_building_device_config(
    building_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = (
        db.query(Building)
        .filter(Building.id == building_id, Building.user_id == user.id)
        .first()
    )
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    config = db.query(BuildingDeviceConfig).filter(BuildingDeviceConfig.building_id == building.id).first()
    return _device_config_out(config, building.id)


@app.put("/api/buildings/{building_id}/device-config", response_model=BuildingDeviceConfigOut)
async def update_building_device_config(
    building_id: int,
    payload: BuildingDeviceConfigIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = (
        db.query(Building)
        .filter(Building.id == building_id, Building.user_id == user.id)
        .first()
    )
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    config = db.query(BuildingDeviceConfig).filter(BuildingDeviceConfig.building_id == building.id).first()
    if config is None:
        config = BuildingDeviceConfig(building_id=building.id)
        db.add(config)

    config.lights_wattage = payload.lights_wattage
    config.lights_hours = payload.lights_hours
    config.fans_wattage = payload.fans_wattage
    config.fans_hours = payload.fans_hours
    config.acs_wattage = payload.acs_wattage
    config.acs_hours = payload.acs_hours
    config.computers_wattage = payload.computers_wattage
    config.computers_hours = payload.computers_hours
    config.lab_wattage = payload.lab_wattage
    config.lab_hours = payload.lab_hours

    db.commit()
    db.refresh(config)
    res = BuildingDeviceConfigOut.model_validate(config)
    await manager.broadcast("device_config_updated", {"building_id": building_id})
    return res


# ── Custom Devices API ───────────────────────────────────────────────────────

@app.get("/api/buildings/{building_id}/custom-devices", response_model=list[CustomDeviceOut])
def list_building_custom_devices(
    building_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = db.query(Building).filter(Building.id == building_id, Building.user_id == user.id).first()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")
    devices = (
        db.query(BuildingCustomDevice)
        .filter(BuildingCustomDevice.building_id == building.id)
        .order_by(BuildingCustomDevice.id.asc())
        .all()
    )
    return [CustomDeviceOut.model_validate(d) for d in devices]


@app.post("/api/buildings/{building_id}/custom-devices", response_model=CustomDeviceOut, status_code=201)
async def create_building_custom_device(
    building_id: int,
    payload: CustomDeviceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = db.query(Building).filter(Building.id == building_id, Building.user_id == user.id).first()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    device = BuildingCustomDevice(
        building_id=building.id,
        name=payload.name.strip(),
        count=payload.count,
        wattage=payload.wattage,
        runtime_hours=payload.runtime_hours,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    res = CustomDeviceOut.model_validate(device)
    await manager.broadcast("custom_device_updated", {"building_id": building.id, "action": "created"})
    return res


@app.put("/api/buildings/{building_id}/custom-devices/{device_id}", response_model=CustomDeviceOut)
async def update_building_custom_device(
    building_id: int,
    device_id: int,
    payload: CustomDeviceUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = db.query(Building).filter(Building.id == building_id, Building.user_id == user.id).first()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    device = (
        db.query(BuildingCustomDevice)
        .filter(BuildingCustomDevice.id == device_id, BuildingCustomDevice.building_id == building.id)
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Custom device not found")

    if payload.name is not None:
        device.name = payload.name.strip()
    if payload.count is not None:
        device.count = payload.count
    if payload.wattage is not None:
        device.wattage = payload.wattage
    if payload.runtime_hours is not None:
        device.runtime_hours = payload.runtime_hours

    db.commit()
    db.refresh(device)
    res = CustomDeviceOut.model_validate(device)
    await manager.broadcast("custom_device_updated", {"building_id": building.id, "action": "updated"})
    return res


@app.delete("/api/buildings/{building_id}/custom-devices/{device_id}", status_code=204)
async def delete_building_custom_device(
    building_id: int,
    device_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    building = db.query(Building).filter(Building.id == building_id, Building.user_id == user.id).first()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    device = (
        db.query(BuildingCustomDevice)
        .filter(BuildingCustomDevice.id == device_id, BuildingCustomDevice.building_id == building.id)
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Custom device not found")

    db.delete(device)
    db.commit()
    await manager.broadcast("custom_device_updated", {"building_id": building.id, "action": "deleted"})
    return None


# ── Energy API ───────────────────────────────────────────────────────────────

@app.get("/api/energy", response_model=list[EnergyReadingOut])
def get_energy_data(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(EnergyReading, Building.name)
        .join(Building, EnergyReading.building_id == Building.id)
        .filter(Building.user_id == user.id)
        .order_by(EnergyReading.recorded_at.desc())
        .limit(50)
        .all()
    )
    return [
        EnergyReadingOut(
            id=r.EnergyReading.id,
            building_id=r.EnergyReading.building_id,
            building_name=r.name,
            meter=r.EnergyReading.meter,
            meter_reading=r.EnergyReading.meter_reading,
            recorded_at=r.EnergyReading.recorded_at,
        )
        for r in rows
    ]


@app.post("/api/energy/manual-reading", response_model=EnergyReadingOut, status_code=201)
async def add_manual_meter_reading(
    payload: ManualMeterReadingIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    name_clean = payload.building_name.strip()
    if not name_clean:
        raise HTTPException(status_code=400, detail="Building Name is required.")

    meter_reading_val = round(float(payload.meter_reading), 2)
    if meter_reading_val < 0:
        raise HTTPException(status_code=400, detail="Meter reading (kWh) must be non-negative.")

    date_str = payload.date.isoformat()
    time_str = payload.time.strftime("%H:%M")
    csv_content = f"Building Name,Date,Time,Meter Reading (kWh)\n{name_clean},{date_str},{time_str},{meter_reading_val}\n"
    csv_bytes = csv_content.encode("utf-8")
    filename = f"manual_{name_clean.replace(' ', '_')}_{date_str}_{payload.time.strftime('%H%M%S')}.csv"

    try:
        report = process_daily_upload(db, user, filename, csv_bytes, get_model())
        batch_id = int(report["batch"]["id"])
        try:
            await run_ai_predictions(db, user)
        except Exception:
            pass
        report = get_upload_report_detail(db, user.id, batch_id)
        if not is_supported_building(name_clean):
            report["warning"] = "No historical data available for this building. Predictions are currently supported only for ADMIN, CHEMI, and ECE."
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        db.rollback()
        raise


    building = (
        db.query(Building)
        .filter(Building.user_id == user.id, func.lower(Building.name) == name_clean.lower())
        .first()
    )
    reading_dt = datetime.combine(payload.date, payload.time).replace(tzinfo=timezone.utc)

    latest_energy = (
        db.query(EnergyReading)
        .filter(EnergyReading.building_id == building.id)
        .order_by(EnergyReading.recorded_at.desc())
        .first()
        if building
        else None
    )

    result = EnergyReadingOut(
        id=latest_energy.id if latest_energy else (building.id if building else 0),
        building_id=building.id if building else 0,
        building_name=name_clean,
        meter=latest_energy.meter if latest_energy else 0,
        meter_reading=meter_reading_val,
        recorded_at=reading_dt,
    )

    await manager.broadcast("daily_upload_processed", report)
    await manager.broadcast("manual_reading_added", result.model_dump(mode="json"))
    await manager.broadcast("energy_refreshed", {"building_id": building.id if building else 0, "refreshed_at": reading_dt.isoformat()})

    return result


@app.post("/api/energy/refresh")
async def refresh_energy_data(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    buildings = db.query(Building).filter(Building.user_id == user.id).all()
    if not buildings:
        raise HTTPException(status_code=404, detail="No buildings found. Add a building first.")

    now = datetime.now(timezone.utc)
    updated = []
    for building in buildings:
        latest = (
            db.query(EnergyReading)
            .filter(EnergyReading.building_id == building.id)
            .order_by(EnergyReading.recorded_at.desc())
            .first()
        )
        base = latest.meter_reading if latest else 10000.0
        reading = EnergyReading(
            building_id=building.id,
            meter=random.randint(100, 500),
            meter_reading=round(base + random.uniform(-200, 300), 2),
            recorded_at=now,
        )
        db.add(reading)
        updated.append(reading)
    db.commit()

    payload = [
        {
            "building_id": r.building_id,
            "meter_reading": r.meter_reading,
            "recorded_at": r.recorded_at.isoformat(),
        }
        for r in updated
    ]
    await manager.broadcast("energy_refreshed", {"readings": payload, "refreshed_at": now.isoformat()})
    return {"message": "Energy data refreshed", "count": len(updated), "refreshed_at": now.isoformat()}


# ── AI Predictions API ───────────────────────────────────────────────────────

def _compute_actual_and_error(
    db: Session,
    building_id: int,
    prediction_for_date: date | None,
    predicted_energy: float,
) -> tuple[float | None, float | None]:
    if prediction_for_date is None:
        return None, None

    actual_row = (
        db.query(func.sum(CampusUploadedReading.meter_reading).label("sum_kwh"))
        .join(CampusUploadBatch, CampusUploadedReading.batch_id == CampusUploadBatch.id)
        .filter(
            CampusUploadedReading.building_id == building_id,
            CampusUploadBatch.batch_date == prediction_for_date,
        )
        .first()
    )
    actual_kwh = float(actual_row.sum_kwh) if actual_row and actual_row.sum_kwh is not None else None

    if actual_kwh is None:
        energy_sum = (
            db.query(func.sum(EnergyReading.meter_reading))
            .filter(
                EnergyReading.building_id == building_id,
                func.date(EnergyReading.recorded_at) == prediction_for_date,
            )
            .scalar()
        )
        if energy_sum is not None:
            actual_kwh = float(energy_sum)

    if actual_kwh is not None:
        actual_energy = round(actual_kwh, 2)
        prediction_error = round(abs(float(predicted_energy) - actual_kwh), 2)
        return actual_energy, prediction_error

    return None, None


# ── AI Predictions API ───────────────────────────────────────────────────────

@app.post("/api/predictions/run", response_model=list[PredictionOut])
async def run_ai_predictions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    buildings = db.query(Building).filter(Building.user_id == user.id).all()
    if not buildings:
        raise HTTPException(status_code=404, detail="No buildings found.")
    building_map = {building.id: building for building in buildings}

    latest_batch = (
        db.query(CampusUploadBatch)
        .filter(CampusUploadBatch.user_id == user.id)
        .order_by(CampusUploadBatch.batch_date.desc(), CampusUploadBatch.uploaded_at.desc())
        .first()
    )
    if latest_batch is None:
        raise HTTPException(status_code=400, detail="Insufficient historical data for campus forecast.")
    prediction_for_date = latest_batch.batch_date + timedelta(days=1)

    latest_totals: dict[int, float] = {}
    latest_rows = (
        db.query(
            CampusUploadedReading.building_id,
            func.sum(CampusUploadedReading.meter_reading).label("total_kwh"),
        )
        .filter(
            CampusUploadedReading.batch_id == latest_batch.id,
            CampusUploadedReading.building_id.isnot(None),
        )
        .group_by(CampusUploadedReading.building_id)
        .all()
    )
    latest_totals = {int(row.building_id): float(row.total_kwh or 0.0) for row in latest_rows}
    if not latest_totals:
        raise HTTPException(status_code=400, detail="Insufficient historical data for campus forecast.")

    results = []
    unsupported_buildings_detected = False

    for building_id, total_kwh in latest_totals.items():
        building = building_map.get(building_id)
        if building is None:
            continue

        if not is_supported_building(building.name):
            unsupported_buildings_detected = True
            continue

        today_total = max(float(total_kwh), 0.0)
        if today_total <= 0:
            continue

        try:
            predicted = predict_next_day_xgboost(db, building, today_total, prediction_for_date)
        except ValueError:
            unsupported_buildings_detected = True
            continue
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Unable to generate campus forecast. {exc}") from exc

        prediction_meter = int(round(today_total))
        latest_prediction = (
            db.query(Prediction)
            .filter(
                Prediction.building_id == building_id,
                Prediction.source_batch_id == latest_batch.id,
            )
            .order_by(Prediction.created_at.desc())
            .first()
        )

        actual_energy, prediction_error = _compute_actual_and_error(db, building_id, prediction_for_date, predicted)

        if (
            latest_prediction is not None
            and latest_prediction.meter == prediction_meter
            and abs(float(latest_prediction.predicted_energy) - float(predicted)) < 1e-9
            and latest_prediction.prediction_for_date == prediction_for_date
        ):
            results.append(
                PredictionOut(
                    id=latest_prediction.id,
                    building_id=building_id,
                    building_name=building.name,
                    source_batch_id=latest_prediction.source_batch_id,
                    meter=latest_prediction.meter,
                    predicted_energy=float(latest_prediction.predicted_energy),
                    prediction_for_date=latest_prediction.prediction_for_date,
                    actual_energy=actual_energy,
                    prediction_error=prediction_error,
                    model_source="college_xgboost",
                    created_at=latest_prediction.created_at,
                )
            )
            continue

        pred = Prediction(
            building_id=building_id,
            source_batch_id=latest_batch.id,
            meter=prediction_meter,
            predicted_energy=predicted,
            prediction_for_date=prediction_for_date,
        )
        db.add(pred)
        db.flush()
        results.append(
            PredictionOut(
                id=pred.id,
                building_id=building_id,
                building_name=building.name,
                source_batch_id=pred.source_batch_id,
                meter=prediction_meter,
                predicted_energy=predicted,
                prediction_for_date=pred.prediction_for_date,
                actual_energy=actual_energy,
                prediction_error=prediction_error,
                model_source="college_xgboost",
                created_at=pred.created_at,
            )
        )

    if not results:
        if unsupported_buildings_detected:
            raise HTTPException(
                status_code=400,
                detail="No historical data available for this building. Predictions are currently supported only for ADMIN, CHEMI, and ECE.",
            )
        raise HTTPException(status_code=400, detail="Insufficient historical data for campus forecast.")

    db.commit()

    await manager.broadcast(
        "predictions_run",
        [r.model_dump(mode="json") for r in results],
    )
    return results


@app.get("/api/predictions", response_model=list[PredictionOut])
def list_predictions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(Prediction, Building.name)
        .join(Building, Prediction.building_id == Building.id)
        .filter(Building.user_id == user.id)
        .order_by(Prediction.created_at.desc())
        .limit(20)
        .all()
    )
    results = []
    for r in rows:
        if not is_supported_building(r.name):
            continue
        actual_energy, prediction_error = _compute_actual_and_error(
            db, r.Prediction.building_id, r.Prediction.prediction_for_date, r.Prediction.predicted_energy
        )
        results.append(
            PredictionOut(
                id=r.Prediction.id,
                building_id=r.Prediction.building_id,
                building_name=r.name,
                source_batch_id=r.Prediction.source_batch_id,
                meter=r.Prediction.meter,
                predicted_energy=r.Prediction.predicted_energy,
                prediction_for_date=r.Prediction.prediction_for_date,
                actual_energy=actual_energy,
                prediction_error=prediction_error,
                model_source="college_xgboost",
                created_at=r.Prediction.created_at,
            )
        )
    return results




@app.get("/api/predictions/xgboost-metrics")
def xgboost_metrics():
    metrics = get_xgboost_metrics()
    if not metrics:
        raise HTTPException(status_code=404, detail="Campus XGBoost metrics not available")
    return {
        "model_name": "Campus XGBoost Regression Model",
        "dataset": "college_energy_data.xlsx",
        "metrics": metrics,
    }


# ── Admin stats ──────────────────────────────────────────────────────────────


@app.get("/api/admin/stats", response_model=AdminStats)
def admin_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        building_ids = [b.id for b in db.query(Building).filter(Building.user_id == user.id).all()]
        building_count = len(building_ids)
        if building_ids:
            total_energy = (
                db.query(func.coalesce(func.sum(EnergyReading.meter_reading), 0.0))
                .filter(EnergyReading.building_id.in_(building_ids))
                .scalar()
            )
            prediction_count = (
                db.query(Prediction).filter(Prediction.building_id.in_(building_ids)).count()
            )
            last_reading = (
                db.query(func.max(EnergyReading.recorded_at))
                .filter(EnergyReading.building_id.in_(building_ids))
                .scalar()
            )
        else:
            total_energy = 0.0
            prediction_count = 0
            last_reading = None
        return AdminStats(
            building_count=building_count,
            total_energy_mwh=round(float(total_energy) / 1000, 2),
            prediction_count=prediction_count,
            last_refresh=last_reading,
            db_connected=True,
        )
    except Exception:
        return AdminStats(
            building_count=0,
            total_energy_mwh=0,
            prediction_count=0,
            last_refresh=None,
            db_connected=False,
        )


@app.post("/api/admin/uploads/daily", response_model=CampusUploadReportOut)
async def upload_daily_meter_readings(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    filename = file.filename or "upload.csv"
    suffix = Path(filename).suffix.lower()
    if suffix not in {".csv", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Only CSV and XLSX uploads are supported")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")

    try:
        report = process_daily_upload(db, user, filename, payload, get_model())
        batch_id = int(report["batch"]["id"])
        try:
            await run_ai_predictions(db, user)
        except Exception:
            pass
        report = get_upload_report_detail(db, user.id, batch_id)
        readings_in_batch = db.query(CampusUploadedReading.building_name).filter(CampusUploadedReading.batch_id == batch_id).distinct().all()
        for r_item in readings_in_batch:
            if not is_supported_building(r_item.building_name):
                report["warning"] = "No historical data available for this building. Predictions are currently supported only for ADMIN, CHEMI, and ECE."
                break
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        db.rollback()
        raise


    await manager.broadcast("daily_upload_processed", report)
    return report


@app.get("/api/admin/uploads/history", response_model=list[CampusUploadHistoryItemOut])
def admin_upload_history(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return list_upload_history(db, user.id)


@app.get("/api/admin/uploads/latest", response_model=CampusUploadReportOut | None)
def admin_latest_upload_report(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return get_latest_upload_report(db, user.id)


@app.get("/api/admin/uploads/history/{batch_id}", response_model=CampusUploadReportOut)
def admin_upload_report_detail(
    batch_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        return get_upload_report_detail(db, user.id, batch_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.delete("/api/admin/uploads/history/{batch_id}")
async def admin_delete_upload_report(
    batch_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        result = delete_upload_history_item(db, user.id, batch_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    await manager.broadcast("daily_upload_history_deleted", result)
    return result


@app.delete("/api/admin/uploads/history")
async def admin_clear_upload_history(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = clear_upload_history(db, user)
    await manager.broadcast("daily_upload_history_cleared", result)
    return result


# ── Export report ────────────────────────────────────────────────────────────

@app.get("/api/export/report")
def export_report(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Prediction ID",
        "Building",
        "Status",
        "Prediction Meter",
        "Predicted Energy (kWh)",
        "Prediction Time",
        "Latest Meter",
        "Latest Reading (kWh)",
        "Last Recorded",
    ])

    rows = (
        db.query(Prediction, Building)
        .join(Building, Prediction.building_id == Building.id)
        .filter(Building.user_id == user.id)
        .order_by(Prediction.created_at.desc())
        .all()
    )

    for prediction, building in rows:
        latest = (
            db.query(EnergyReading)
            .filter(EnergyReading.building_id == building.id)
            .order_by(EnergyReading.recorded_at.desc())
            .first()
        )
        writer.writerow([
            prediction.id,
            building.name,
            building.status,
            prediction.meter,
            prediction.predicted_energy,
            prediction.created_at.isoformat() if prediction.created_at else "",
            latest.meter if latest else "",
            latest.meter_reading if latest else "",
            latest.recorded_at.isoformat() if latest else "",
        ])

    if not rows:
        writer.writerow(["", "No predictions available", "", "", "", "", "", "", ""])

    output.seek(0)
    filename = f"campus_energy_report_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
