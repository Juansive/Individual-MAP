from sqlalchemy import inspect
from sqlmodel import Session, SQLModel, create_engine

from app import migrations, models  # noqa: F401  导入 models 后表定义才会注册到 metadata
from app.config import DB_PATH

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


def init_db() -> None:
    """建好缺少的表，再执行还没执行过的数据库升级（见 migrations.py）。"""
    fresh = not inspect(engine).get_table_names()  # 第一次运行，还没有任何表
    SQLModel.metadata.create_all(engine)
    if fresh:
        migrations.mark_up_to_date()
    done = migrations.migrate()
    if done:
        print(f"数据库已升级：{'、'.join(done)}")


def get_session():
    """FastAPI 依赖：每个请求一个数据库会话。"""
    with Session(engine, expire_on_commit=False) as session:
        yield session
