from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import router
from logger import logger

@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("🚀 FastAPI Application has started successfully!")
    yield
    logger.info("🛑 FastAPI Application is shutting down...")

app = FastAPI(title="TTS Local Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)