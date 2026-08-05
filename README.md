# 🍚 今天吃什么

干饭小站：选餐、热量记录、抽卡随机选菜、Omakase 套餐、小饭桌、喂猫。

## 架构

- **前端**：`index.html` 单文件应用（无构建工具），游客模式纯 localStorage
- **后端**：Node.js + Express（`server.js` + `src/`），JWT 认证
- **数据库**：PostgreSQL（`schema.sql` 启动时幂等建表，`seed-dishes.json` 播种系统菜品）
- **部署**：Render Web Service + Render PostgreSQL（见 `render.yaml`）

## 功能

- 游客模式：所有功能本地可用，无需登录
- 云端账号：注册/登录后，菜单、进食记录、拒吃黑名单多设备同步
- 共享房间：创建/邀请码加入，房间自定义菜全员共享，小饭桌显示成员今日干饭情况
- 首登迁移：游客 localStorage 数据自动上传到个人空间（幂等）

## 本地开发

```bash
cp .env.example .env   # 填 DATABASE_URL（本地或 Render 外部连接串）和 JWT_SECRET
# 如果连的是 Render 外部 PG，加 PG_SSL=true
npm install
npm start              # http://localhost:3000
```

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register | 注册 |
| POST | /api/auth/login | 登录 |
| GET | /api/auth/me | 当前用户 |
| PUT | /api/auth/profile | 改昵称/颜色/头像 |
| GET | /api/state | 一次性水合全量状态 |
| GET | /api/system-dishes | 系统菜品目录（静态） |
| GET/POST | /api/dishes | 自定义菜列表/新增（scope=user\|room） |
| PUT/DELETE | /api/dishes/:id | 改/删自定义菜 |
| POST | /api/rooms | 创建房间 |
| POST | /api/rooms/join | 邀请码加入 |
| GET | /api/rooms | 我的房间列表 |
| POST | /api/rooms/:id/leave | 退出房间 |
| GET | /api/rooms/:id/table?date= | 房间饭桌视图 |
| GET/POST/DELETE | /api/history[/:id] | 进食记录 |
| GET/PUT | /api/blacklist | 黑名单（PUT 全量替换） |
| POST | /api/migrate | 首登数据迁移（幂等） |

## Render 免费层注意事项

- Web Service 15 分钟无访问会休眠，冷启动约 30–60 秒（前端会先渲染游客 UI，不受影响）
- **免费 PostgreSQL 30 天后到期**，到期前导出数据：

```bash
pg_dump "$DATABASE_URL" > backup.sql
```

## 部署

push 到 GitHub 后，在 Render 用 Blueprint（`render.yaml`）一键创建 Web Service + PostgreSQL，环境变量自动注入。
