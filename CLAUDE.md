# CLAUDE.md

个人素材库 + 3D 星图，本地运行的 FastAPI 应用。**开始工作前先读 `docs/交接文档.md`**，里面有架构、实现要点、踩过的坑和待办清单；**第 0 节是当前状态和已确认、待实现的下一步**。

## 必须遵守

- 用中文交流；代码注释用中文，风格与现有代码一致。用户偏好 Python。
- 视觉、交互类的较大改动：先给方案讨论，用户确认后再做；做完附前后对比截图。
- **不要碰用户的真实数据**：用户用 `start.bat` 在 8765 端口运行，数据在 `data/`。测试时另起服务器：
  `IMAP_DATA_DIR=<临时目录> .venv/Scripts/python.exe -m uvicorn app.main:app --port 8767`
- 模板中引用静态文件一律用 `static_url('xxx')`（自动加版本号，避免浏览器缓存旧文件）。
- 星图的 3D 库是打包好的 `app/static/vendor/graph-lib.js`；需要新的 three.js 模块时，改 `tools/graph-lib/entry.js` 后重新打包，不要另外引入第二份 three。
- 改表结构时，除了改 `models.py`，还要在 `app/migrations.py` 的 `MIGRATIONS` 末尾追加升级函数（只追加，不改旧的）。
- 改了后端逻辑就跑一遍测试；新功能尽量补测试。
- 多项改动一个个做，每做完一项给用户看效果；提交说明只写一行简短的话，提交和推送前先问用户。

## 常用命令

```bash
.venv/Scripts/python.exe run.py                              # 启动（8765，真实数据）
.venv/Scripts/python.exe -m pytest -q                        # 跑测试（自动使用临时数据目录）
cd tools/graph-lib && npm install && npm run build           # 重新打包 3D 库（完成后删除 node_modules）
```
