"""
Create the campus_energy database and initialize tables.

Usage:
  1. Copy .env.example to .env and set your PostgreSQL password
  2. python backend/setup_db.py
"""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg2
from dotenv import load_dotenv
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/campus_energy",
)


def create_database():
    parsed = urlparse(DATABASE_URL)
    db_name = parsed.path.lstrip("/") or "campus_energy"

    conn_params = {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "user": parsed.username or "postgres",
        "password": parsed.password or "",
        "dbname": "postgres",
    }

    print(f"Connecting to PostgreSQL at {conn_params['host']}:{conn_params['port']}...")
    conn = psycopg2.connect(**conn_params)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()

    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
    if cur.fetchone():
        print(f"Database '{db_name}' already exists.")
    else:
        cur.execute(f'CREATE DATABASE "{db_name}"')
        print(f"Database '{db_name}' created.")

    cur.close()
    conn.close()


def init_tables():
    sys.path.insert(0, str(Path(__file__).parent))
    from init_db import init_database

    init_database()
    print("Tables initialized and seed data loaded.")


if __name__ == "__main__":
    create_database()
    init_tables()
    print("\nSetup complete! Start the API with:")
    print("  cd backend && ..\\venv\\Scripts\\uvicorn app:app --reload --port 8000")
