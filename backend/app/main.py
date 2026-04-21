from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from .config import get_settings
from .routers import (
    courses,
    ge,
    health,
    majors,
    optimize,
    predict,
    professors,
    schedules,
    sections,
    trends,
)


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ]
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    _configure_logging(settings.ace_log_level)
    log = structlog.get_logger()
    log.info("ace.startup", env=settings.ace_env, model_dir=str(settings.ace_model_dir))
    yield
    log.info("ace.shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="ACE Backend",
        version="0.1.0",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(courses.router)
    app.include_router(sections.router)
    app.include_router(professors.router)
    app.include_router(majors.router)
    app.include_router(ge.router)
    app.include_router(trends.router)
    app.include_router(predict.router)
    app.include_router(optimize.router)
    app.include_router(schedules.router)
    return app


app = create_app()
