import csv
import io
import os
import random
from datetime import datetime, timezone
from pathlib import Path

import joblib
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import create_access_token, get_current_user, hash_password, verify_password
from database import get_db
from init_db import init_database
from models import Building, EnergyReading, Prediction, User
from realtime import manager
from schemas import (
    AdminStats,
    AlertOut,
    AuthResponse,
    BuildingCreate,
    BuildingOut,
    DashboardOverview,
    EnergyInput,
    EnergyReadingOut,
    PredictionOut,
    TrendPoint,
    UserLogin,
    UserOut,
    UserSignup,
)
from services import build_alerts, get_dashboard_overview, get_energy_trend
from feature_utils import build_feature_row

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


@app.on_event("startup")
def on_startup():
    init_database()


# ── Existing endpoints (unchanged contract) ──────────────────────────────────

@app.get("/")
def home():
    return {"message": "Campus Energy Optimization API is running!"}


@app.post("/predict")
def predict(data: EnergyInput):
    model = get_model()
    if model is None:
        raise HTTPException(status_code=503, detail="AI model not trained yet. Run ai/train_model.py first.")
    feature_df = build_feature_row(data.building_id, data.meter)
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
    db.add(
        EnergyReading(
            building_id=building.id,
            meter=random.randint(100, 500),
            meter_reading=round(random.uniform(5000, 18000), 2),
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

@app.post("/api/predictions/run", response_model=list[PredictionOut])
async def run_ai_predictions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    model = get_model()
    buildings = db.query(Building).filter(Building.user_id == user.id).all()
    if not buildings:
        raise HTTPException(status_code=404, detail="No buildings found.")

    results = []
    for building in buildings:
        latest = (
            db.query(EnergyReading)
            .filter(EnergyReading.building_id == building.id)
            .order_by(EnergyReading.recorded_at.desc())
            .first()
        )
        meter = latest.meter if latest else random.randint(100, 500)

        if model is not None:
            feature_df = build_feature_row(building.id, meter, latest.recorded_at if latest else None)
            predicted = float(model.predict(feature_df)[0])
        else:
            predicted = round((latest.meter_reading if latest else 10000) * random.uniform(0.95, 1.05), 2)

        pred = Prediction(
            building_id=building.id,
            meter=meter,
            predicted_energy=predicted,
        )
        db.add(pred)
        db.flush()
        results.append(
            PredictionOut(
                id=pred.id,
                building_id=building.id,
                building_name=building.name,
                meter=meter,
                predicted_energy=predicted,
                created_at=pred.created_at,
            )
        )
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
    return [
        PredictionOut(
            id=r.Prediction.id,
            building_id=r.Prediction.building_id,
            building_name=r.name,
            meter=r.Prediction.meter,
            predicted_energy=r.Prediction.predicted_energy,
            created_at=r.Prediction.created_at,
        )
        for r in rows
    ]


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


# ── Export report ────────────────────────────────────────────────────────────

@app.get("/api/export/report")
def export_report(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Building", "Status", "Latest Meter", "Latest Reading (kWh)", "Last Recorded"])

    buildings = db.query(Building).filter(Building.user_id == user.id).order_by(Building.id).all()
    for building in buildings:
        latest = (
            db.query(EnergyReading)
            .filter(EnergyReading.building_id == building.id)
            .order_by(EnergyReading.recorded_at.desc())
            .first()
        )
        writer.writerow([
            building.name,
            building.status,
            latest.meter if latest else "",
            latest.meter_reading if latest else "",
            latest.recorded_at.isoformat() if latest else "",
        ])

    output.seek(0)
    filename = f"campus_energy_report_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
