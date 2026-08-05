const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("缺少环境变量 JWT_SECRET");
  process.exit(1);
}

function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: "30d",
  });
}

// 鉴权中间件：解析 Authorization: Bearer <jwt>，把用户 id 挂到 req.uid
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "未登录" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.uid = payload.uid;
    next();
  } catch {
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

// 用户对象的对外安全形态（绝不带 password_hash）
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    color: u.color,
    avatar: u.avatar,
  };
}

module.exports = { hashPassword, checkPassword, signToken, authRequired, publicUser };
