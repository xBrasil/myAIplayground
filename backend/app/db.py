from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings


settings = get_settings()
database_path = settings.resolved_database_path
database_path.parent.mkdir(parents=True, exist_ok=True)
settings.resolved_upload_dir.mkdir(parents=True, exist_ok=True)
settings.resolved_model_cache_dir.mkdir(parents=True, exist_ok=True)

engine = create_engine(f"sqlite:///{database_path}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_db_and_tables() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)

    # Lightweight migrations for existing databases
    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("messages")}
    if "model_key" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE messages ADD COLUMN model_key VARCHAR(16)"))
    if "tool_calls_json" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE messages ADD COLUMN tool_calls_json TEXT"))
