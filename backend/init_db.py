"""Create tables and run lightweight schema migrations."""

from sqlalchemy import inspect, text

from database import Base, SessionLocal, engine
from models import Building, User


def _migrate_building_ownership():
  inspector = inspect(engine)
  if "buildings" not in inspector.get_table_names():
    return

  columns = {c["name"] for c in inspector.get_columns("buildings")}
  if "user_id" in columns:
    return

  with engine.begin() as conn:
    conn.execute(text("ALTER TABLE buildings ADD COLUMN user_id INTEGER REFERENCES users(id)"))

    first_user = conn.execute(text("SELECT id FROM users ORDER BY id LIMIT 1")).fetchone()
    if first_user:
      conn.execute(
        text("UPDATE buildings SET user_id = :uid WHERE user_id IS NULL"),
        {"uid": first_user[0]},
      )
      conn.execute(text("DELETE FROM buildings WHERE user_id IS NULL"))
    else:
      conn.execute(text("DELETE FROM predictions WHERE building_id IN (SELECT id FROM buildings)"))
      conn.execute(text("DELETE FROM energy_readings WHERE building_id IN (SELECT id FROM buildings)"))
      conn.execute(text("DELETE FROM buildings"))

    conn.execute(text("ALTER TABLE buildings ALTER COLUMN user_id SET NOT NULL"))

  print("Migration complete: buildings are now scoped per user.")


def _migrate_prediction_batch_linkage():
  inspector = inspect(engine)
  if "predictions" not in inspector.get_table_names():
    return

  columns = {c["name"] for c in inspector.get_columns("predictions")}
  foreign_keys = {fk.get("name") for fk in inspector.get_foreign_keys("predictions") if fk.get("name")}

  with engine.begin() as conn:
    if "source_batch_id" not in columns:
      conn.execute(text("ALTER TABLE predictions ADD COLUMN source_batch_id INTEGER"))
    if "prediction_for_date" not in columns:
      conn.execute(text("ALTER TABLE predictions ADD COLUMN prediction_for_date DATE"))

    if "fk_predictions_source_batch_id" not in foreign_keys:
      try:
        conn.execute(
          text(
            "ALTER TABLE predictions "
            "ADD CONSTRAINT fk_predictions_source_batch_id "
            "FOREIGN KEY (source_batch_id) REFERENCES campus_upload_batches(id) ON DELETE SET NULL"
          )
        )
      except Exception:
        # Keep startup resilient if the constraint already exists with a different auto-generated name.
        pass

    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_predictions_source_batch_id ON predictions(source_batch_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_predictions_prediction_for_date ON predictions(prediction_for_date)"))

  print("Migration complete: predictions now support source batch linkage.")


def init_database():
  try:
    Base.metadata.create_all(bind=engine)
    _migrate_building_ownership()
    _migrate_prediction_batch_linkage()
  except Exception as exc:
    print(f"WARNING: Could not connect to PostgreSQL — {exc}")
    print("Set DATABASE_URL in .env and run: python backend/setup_db.py")
    return

  db = SessionLocal()
  try:
    user_count = db.query(User).count()
    building_count = db.query(Building).count()
    if building_count == 0:
      print("Database ready — new users start with an empty campus.")
    else:
      print(f"Database ready — {user_count} user(s), {building_count} building(s).")
  finally:
    db.close()


if __name__ == "__main__":
  init_database()
