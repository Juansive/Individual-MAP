from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import backup
from app.config import STATIC_DIR, ensure_dirs
from app.db import init_db
from app.routes import entries, export, files, graph, inbox, links, skills


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_dirs()
    backup.auto_backup("startup")  # 先备份再动数据库
    init_db()
    yield


app = FastAPI(title="Individual Map", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

for module in (entries, links, files, inbox, skills, graph, export):
    app.include_router(module.router)
