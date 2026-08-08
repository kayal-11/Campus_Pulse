from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from database import Base


def utcnow():
    return datetime.now(timezone.utc)


class Building(Base):
    __tablename__ = "buildings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, default="")
    status = Column(String(40), default="Active")
    created_at = Column(DateTime(timezone=True), default=utcnow)

    owner = relationship("User", back_populates="buildings")
    inventory = relationship("BuildingInventory", back_populates="building", uselist=False, cascade="all, delete-orphan")
    device_config = relationship("BuildingDeviceConfig", back_populates="building", uselist=False, cascade="all, delete-orphan")
    energy_readings = relationship("EnergyReading", back_populates="building", cascade="all, delete-orphan")
    predictions = relationship("Prediction", back_populates="building", cascade="all, delete-orphan")
    campus_aliases = relationship("CampusBuildingAlias", back_populates="building", cascade="all, delete-orphan")
    uploaded_readings = relationship("CampusUploadedReading", back_populates="building")
    upload_forecasts = relationship("CampusUploadForecast", back_populates="building")


class BuildingInventory(Base):
    __tablename__ = "building_inventory"

    id = Column(Integer, primary_key=True, index=True)
    building_id = Column(Integer, ForeignKey("buildings.id"), nullable=False, unique=True, index=True)
    lights = Column(Integer, nullable=False, default=0)
    fans = Column(Integer, nullable=False, default=0)
    ac_units = Column(Integer, nullable=False, default=0)
    computers = Column(Integer, nullable=False, default=0)
    lab_equipment = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    building = relationship("Building", back_populates="inventory")


class BuildingDeviceConfig(Base):
    __tablename__ = "building_device_config"

    id = Column(Integer, primary_key=True, index=True)
    building_id = Column(Integer, ForeignKey("buildings.id"), nullable=False, unique=True, index=True)
    lights_wattage = Column(Float, nullable=False, default=20.0)
    lights_hours = Column(Float, nullable=False, default=11.0)
    fans_wattage = Column(Float, nullable=False, default=75.0)
    fans_hours = Column(Float, nullable=False, default=10.0)
    acs_wattage = Column(Float, nullable=False, default=1500.0)
    acs_hours = Column(Float, nullable=False, default=8.0)
    computers_wattage = Column(Float, nullable=False, default=140.0)
    computers_hours = Column(Float, nullable=False, default=9.0)
    lab_wattage = Column(Float, nullable=False, default=900.0)
    lab_hours = Column(Float, nullable=False, default=7.0)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    building = relationship("Building", back_populates="device_config")


class EnergyReading(Base):
    __tablename__ = "energy_readings"

    id = Column(Integer, primary_key=True, index=True)
    building_id = Column(Integer, ForeignKey("buildings.id"), nullable=False, index=True)
    meter = Column(Integer, nullable=False, default=0)
    meter_reading = Column(Float, nullable=False)
    recorded_at = Column(DateTime(timezone=True), default=utcnow, index=True)

    building = relationship("Building", back_populates="energy_readings")


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    building_id = Column(Integer, ForeignKey("buildings.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("campus_upload_batches.id", ondelete="SET NULL"), nullable=True, index=True)
    meter = Column(Integer, nullable=False, default=0)
    predicted_energy = Column(Float, nullable=False)
    prediction_for_date = Column(Date, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)

    building = relationship("Building", back_populates="predictions")
    source_batch = relationship("CampusUploadBatch")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(40), default="operator")
    created_at = Column(DateTime(timezone=True), default=utcnow)

    buildings = relationship("Building", back_populates="owner", cascade="all, delete-orphan")
    campus_aliases = relationship("CampusBuildingAlias", back_populates="owner", cascade="all, delete-orphan")
    upload_batches = relationship("CampusUploadBatch", back_populates="owner", cascade="all, delete-orphan")
    uploaded_readings = relationship("CampusUploadedReading", back_populates="owner", cascade="all, delete-orphan")
    upload_forecasts = relationship("CampusUploadForecast", back_populates="owner", cascade="all, delete-orphan")


class CampusBuildingAlias(Base):
    __tablename__ = "campus_building_aliases"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    building_id = Column(Integer, ForeignKey("buildings.id"), nullable=False, index=True)
    external_building_id = Column(String(120), nullable=True, index=True)
    external_building_name = Column(String(120), nullable=False, default="")
    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "external_building_id", name="uq_campus_alias_user_external_id"),
    )

    owner = relationship("User", back_populates="campus_aliases")
    building = relationship("Building", back_populates="campus_aliases")


class CampusUploadBatch(Base):
    __tablename__ = "campus_upload_batches"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_filename = Column(String(255), nullable=False)
    batch_date = Column(Date, nullable=False, index=True)
    record_count = Column(Integer, nullable=False, default=0)
    total_kwh = Column(Float, nullable=False, default=0.0)
    previous_total_kwh = Column(Float, nullable=True)
    percentage_change = Column(Float, nullable=True)
    high_consumption_count = Column(Integer, nullable=False, default=0)
    comparison_ready = Column(Boolean, nullable=False, default=False)
    uploaded_at = Column(DateTime(timezone=True), default=utcnow, index=True)

    owner = relationship("User", back_populates="upload_batches")
    readings = relationship("CampusUploadedReading", back_populates="batch", cascade="all, delete-orphan")
    forecasts = relationship("CampusUploadForecast", back_populates="batch", cascade="all, delete-orphan")


class CampusUploadedReading(Base):
    __tablename__ = "campus_uploaded_readings"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("campus_upload_batches.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    building_id = Column(Integer, ForeignKey("buildings.id"), nullable=True, index=True)
    building_name = Column(String(120), nullable=False)
    external_building_id = Column(String(120), nullable=True, index=True)
    reading_at = Column(DateTime(timezone=True), nullable=False, index=True)
    meter_reading = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    batch = relationship("CampusUploadBatch", back_populates="readings")
    owner = relationship("User", back_populates="uploaded_readings")
    building = relationship("Building", back_populates="uploaded_readings")


class CampusUploadForecast(Base):
    __tablename__ = "campus_upload_forecasts"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("campus_upload_batches.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    building_id = Column(Integer, ForeignKey("buildings.id"), nullable=True, index=True)
    building_name = Column(String(120), nullable=False)
    predicted_energy = Column(Float, nullable=False)
    risk_level = Column(String(40), nullable=False)
    recommendation = Column(Text, nullable=False)
    model_source = Column(String(80), nullable=False, default="campus_rf")
    created_at = Column(DateTime(timezone=True), default=utcnow)

    batch = relationship("CampusUploadBatch", back_populates="forecasts")
    owner = relationship("User", back_populates="upload_forecasts")
    building = relationship("Building", back_populates="upload_forecasts")
