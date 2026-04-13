from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import chat, conversations, health, legal, models
from app.api.routes import settings as settings_routes
from app.core.config import ALLOWED_ORIGINS, get_settings
from app.db import create_db_and_tables
from app.services.model_service import model_service


settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_db_and_tables()
    if settings.enable_model_loading:
        model_service.load()
    yield
    model_service._shutdown()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(settings.resolved_upload_dir)), name="uploads")

app.include_router(health.router, prefix="/api")
app.include_router(legal.router, prefix="/api")
app.include_router(settings_routes.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
