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


def init_database():
  try:
    Base.metadata.create_all(bind=engine)
    _migrate_building_ownership()
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
