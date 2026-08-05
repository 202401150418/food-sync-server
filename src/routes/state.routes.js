const express = require("express");
const { query, withTx } = require("../db");
const { authRequired, publicUser } = require("../auth");
const { reqInt, wrap } = require("../validate");

const router = express.Router();
router.use(authRequired);

// 一次性水合：用户 + 个人菜 + 房间(含成员) + 各房间菜 + 历史 + 黑名单
router.get("/state", wrap(async (req, res) => {
  const user = (await query(
    `SELECT id, username, nickname, color, avatar FROM users WHERE id = $1`, [req.uid]
  )).rows[0];
  if (!user) return res.status(401).json({ error: "账号不存在" });

  const personal = (await query(
    `SELECT id, name, emoji, kcal, cat, created_by FROM dishes
     WHERE scope_type = 'user' AND scope_id = $1 ORDER BY id`, [req.uid]
  )).rows;

  const memberships = (await query(
    `SELECT room_id FROM room_members WHERE user_id = $1 ORDER BY joined_at`, [req.uid]
  )).rows;

  const rooms = [];
  const roomDishes = {};
  for (const m of memberships) {
    const room = (await query(`SELECT * FROM rooms WHERE id = $1`, [m.room_id])).rows[0];
    const members = (await query(
      `SELECT u.id, u.username, u.nickname, u.color, u.avatar
       FROM room_members rm JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1 ORDER BY rm.joined_at`, [m.room_id]
    )).rows;
    rooms.push({
      id: room.id, name: room.name, invite_code: room.invite_code,
      owner_id: room.owner_id, members,
    });
    roomDishes[room.id] = (await query(
      `SELECT id, name, emoji, kcal, cat, created_by FROM dishes
       WHERE scope_type = 'room' AND scope_id = $1 ORDER BY id`, [room.id]
    )).rows;
  }

  const history = (await query(
    `SELECT id, client_id, time, date, meal, items, total FROM history
     WHERE user_id = $1 ORDER BY id DESC LIMIT 500`, [req.uid]
  )).rows;

  const blacklist = (await query(
    `SELECT name FROM blacklist WHERE user_id = $1 ORDER BY name`, [req.uid]
  )).rows.map((r) => r.name);

  res.json({
    user: publicUser(user),
    dishes: { personal },
    rooms,
    roomDishes,
    history,
    blacklist,
  });
}));

// 首登迁移：把游客 localStorage 数据批量导入（幂等，可安全重试）
router.post("/migrate", wrap(async (req, res) => {
  const { history = [], blacklist = [], customDishes = [], profile = {} } = req.body;
  if (!Array.isArray(history) || !Array.isArray(blacklist) || !Array.isArray(customDishes)) {
    throw new Error("迁移数据格式不对");
  }
  if (history.length > 2000 || blacklist.length > 500 || customDishes.length > 200) {
    throw new Error("迁移数据量超限");
  }

  const result = await withTx(async (client) => {
    let dishesN = 0, historyN = 0, blacklistN = 0;

    for (const d of customDishes) {
      const r = await client.query(
        `INSERT INTO dishes (scope_type, scope_id, name, emoji, kcal, cat, created_by)
         VALUES ('user', $1, $2, $3, $4, '自定义', $1) ON CONFLICT DO NOTHING`,
        [
          req.uid,
          String(d.name || "").slice(0, 30),
          String(d.emoji || "🍽️").slice(0, 8),
          reqInt(d.kcal, { min: 0, max: 5000, label: "热量" }),
        ]
      );
      dishesN += r.rowCount;
    }

    for (const h of history) {
      if (!Array.isArray(h.items)) continue;
      const clientId = h.id ? reqInt(h.id, { min: 1, max: Number.MAX_SAFE_INTEGER, label: "记录 id" }) : null;
      const r = await client.query(
        `INSERT INTO history (user_id, client_id, time, date, meal, items, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (user_id, client_id) DO NOTHING`,
        [
          req.uid, clientId,
          String(h.time || "").slice(0, 16),
          String(h.date || "").slice(0, 10),
          h.meal === "dinner" ? "dinner" : "lunch",
          JSON.stringify(h.items.slice(0, 30)),
          reqInt(h.total || 0, { min: 0, max: 100000, label: "总热量" }),
        ]
      );
      historyN += r.rowCount;
    }

    for (const n of blacklist) {
      const name = String(n || "").trim().slice(0, 30);
      if (!name) continue;
      const r = await client.query(
        `INSERT INTO blacklist (user_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.uid, name]
      );
      blacklistN += r.rowCount;
    }

    // 资料仅在用户还没设置过时填充，避免覆盖云端已有资料
    if (profile.nickname || profile.color || profile.avatar) {
      await client.query(
        `UPDATE users SET
           nickname = COALESCE(NULLIF($2, ''), nickname),
           color    = COALESCE(color, $3),
           avatar   = COALESCE(avatar, $4)
         WHERE id = $1`,
        [
          req.uid,
          String(profile.nickname || "").slice(0, 24),
          profile.color ? String(profile.color).slice(0, 9) : null,
          typeof profile.avatar === "string" && profile.avatar.startsWith("data:image/")
            ? profile.avatar.slice(0, 200000) : null,
        ]
      );
    }

    return { dishes: dishesN, history: historyN, blacklist: blacklistN };
  });

  res.json({ ok: true, imported: result });
}));

module.exports = router;
