try {
  require("dotenv").config();
} catch {
  // 生产环境（Render）没有 dotenv 也能跑，环境变量由平台注入
}

const express = require("express");
const path = require("path");
const { migrate } = require("./src/db");

const app = express();
app.use(express.json({ limit: "1mb" })); // 头像是 ~10-20KB 的 dataURL

// API 路由
app.use("/api/auth", require("./src/routes/auth.routes"));
app.use("/api/dishes", require("./src/routes/dishes.routes"));
app.use("/api/rooms", require("./src/routes/rooms.routes"));
app.use("/api/history", require("./src/routes/history.routes"));
app.use("/api/blacklist", require("./src/routes/blacklist.routes"));

// 系统菜品目录：公开静态 JSON，长缓存（必须在 state.routes 之前，
// 否则 /api/system-dishes 会被 state 路由的 authRequired 拦截要求登录）
app.get("/api/system-dishes", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(path.join(__dirname, "seed-dishes.json"));
});

app.use("/api", require("./src/routes/state.routes")); // /api/state, /api/migrate

// /api 下的 404 返回 JSON 而不是 HTML
app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));

// 静态托管 + SPA 兜底
app.use(express.static(__dirname));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const port = process.env.PORT || 3000;
migrate()
  .then(() => {
    app.listen(port, () => console.log(`开饭啦：http://localhost:${port}`));
  })
  .catch((e) => {
    console.error("数据库初始化失败：", e);
    process.exit(1);
  });
