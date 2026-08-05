const express = require("express");
const rateLimit = require("express-rate-limit");
const { query } = require("../db");
const { hashPassword, checkPassword, signToken, authRequired, publicUser } = require("../auth");
const { reqStr, wrap } = require("../validate");

const router = express.Router();

// 登录/注册限流：每 IP 15 分钟 20 次
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "尝试太频繁了，过一会儿再来吧" },
});

router.post("/register", authLimiter, wrap(async (req, res) => {
  const username = reqStr(req.body.username, { min: 2, max: 32, label: "用户名" });
  const password = reqStr(req.body.password, { min: 6, max: 72, label: "密码" });
  const nickname = req.body.nickname
    ? reqStr(req.body.nickname, { min: 1, max: 24, label: "昵称" })
    : username;

  const hash = await hashPassword(password);
  try {
    const { rows } = await query(
      `INSERT INTO users (username, nickname, password_hash) VALUES ($1, $2, $3)
       RETURNING id, username, nickname, color, avatar`,
      [username, nickname, hash]
    );
    const user = rows[0];
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "这个用户名已被占用" });
    throw e;
  }
}));

router.post("/login", authLimiter, wrap(async (req, res) => {
  const username = reqStr(req.body.username, { min: 1, max: 32, label: "用户名" });
  const password = reqStr(req.body.password, { min: 1, max: 72, label: "密码" });

  const { rows } = await query(`SELECT * FROM users WHERE username = $1`, [username]);
  const user = rows[0];
  // 用户不存在和密码错误返回同样的信息，避免探测用户名
  if (!user || !(await checkPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get("/me", authRequired, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, username, nickname, color, avatar FROM users WHERE id = $1`,
    [req.uid]
  );
  if (!rows[0]) return res.status(401).json({ error: "账号不存在" });
  res.json({ user: publicUser(rows[0]) });
}));

router.put("/profile", authRequired, wrap(async (req, res) => {
  const fields = [];
  const values = [];
  if (req.body.nickname !== undefined) {
    values.push(reqStr(req.body.nickname, { min: 1, max: 24, label: "昵称" }));
    fields.push(`nickname = $${values.length}`);
  }
  if (req.body.color !== undefined) {
    const color = reqStr(req.body.color, { min: 4, max: 9, label: "颜色" });
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) throw new Error("颜色格式不对");
    values.push(color);
    fields.push(`color = $${values.length}`);
  }
  if (req.body.avatar !== undefined) {
    const avatar = req.body.avatar;
    if (avatar !== null && (typeof avatar !== "string" || avatar.length > 200000 || !avatar.startsWith("data:image/"))) {
      throw new Error("头像格式不对或太大了");
    }
    values.push(avatar);
    fields.push(`avatar = $${values.length}`);
  }
  if (!fields.length) throw new Error("没有要更新的内容");

  values.push(req.uid);
  const { rows } = await query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = $${values.length}
     RETURNING id, username, nickname, color, avatar`,
    values
  );
  res.json({ user: publicUser(rows[0]) });
}));

module.exports = router;
