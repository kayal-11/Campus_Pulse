from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
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
    energy_readings = relationship("EnergyReading", back_populates="building", cascade="all, delete-orphan")
    predictions = relationship("Prediction", back_populates="building", cascade="all, delete-orphan")


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
    meter = Column(Integer, nullable=False, default=0)
    predicted_energy = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)

    building = relationship("Building", back_populates="predictions")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(40), default="operator")
    created_at = Column(DateTime(timezone=True), default=utcnow)

    buildings = relationship("Building", back_populates="owner", cascade="all, delete-orphan")
