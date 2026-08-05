const express = require("express");
const { query } = require("../db");
const { authRequired } = require("../auth");
const { reqStr, reqInt, wrap } = require("../validate");

const router = express.Router();
router.use(authRequired);

// 校验目标 scope 权限，返回 { scopeType, scopeId }
async function resolveScope(req) {
  const scope = req.body.scope || req.query.scope;
  if (scope === "user") return { scopeType: "user", scopeId: req.uid };
  if (scope === "room") {
    const roomId = reqInt(req.body.roomId || req.query.roomId, { min: 1, label: "房间 ID" });
    const { rows } = await query(
      `SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2`,
      [roomId, req.uid]
    );
    if (!rows.length) throw Object.assign(new Error("你不是这个房间的成员"), { status: 403 });
    return { scopeType: "room", scopeId: roomId };
  }
  throw new Error("scope 必须是 user 或 room");
}

// 校验某道菜是否可由当前用户修改（个人菜=本人；房间菜=任一成员）
async function canModifyDish(dishId, uid) {
  const { rows } = await query(`SELECT * FROM dishes WHERE id = $1`, [dishId]);
  const dish = rows[0];
  if (!dish) throw Object.assign(new Error("菜品不存在"), { status: 404 });
  if (dish.scope_type === "user") {
    if (dish.scope_id !== uid) throw Object.assign(new Error("只能改自己的菜"), { status: 403 });
  } else {
    const m = await query(
      `SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2`,
      [dish.scope_id, uid]
    );
    if (!m.rows.length) throw Object.assign(new Error("你不是这个房间的成员"), { status: 403 });
  }
  return dish;
}

router.get("/", wrap(async (req, res) => {
  const { scopeType, scopeId } = await resolveScope(req);
  const { rows } = await query(
    `SELECT id, name, emoji, kcal, cat, created_by FROM dishes
     WHERE scope_type = $1 AND scope_id = $2 ORDER BY id`,
    [scopeType, scopeId]
  );
  res.json({ dishes: rows });
}));

router.post("/", wrap(async (req, res) => {
  const { scopeType, scopeId } = await resolveScope(req);
  const name = reqStr(req.body.name, { min: 1, max: 30, label: "菜名" });
  const emoji = req.body.emoji ? reqStr(req.body.emoji, { max: 8, label: "表情" }) : "🍽️";
  const kcal = reqInt(req.body.kcal, { min: 0, max: 5000, label: "热量" });
  const cat = req.body.cat ? reqStr(req.body.cat, { max: 12, label: "分类" }) : "自定义";

  const { rows } = await query(
    `INSERT INTO dishes (scope_type, scope_id, name, emoji, kcal, cat, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, emoji, kcal, cat, created_by`,
    [scopeType, scopeId, name, emoji, kcal, cat, req.uid]
  );
  res.json({ dish: rows[0] });
}));

router.put("/:id", wrap(async (req, res) => {
  const dishId = reqInt(req.params.id, { min: 1, label: "菜品 ID" });
  const dish = await canModifyDish(dishId, req.uid);

  const name = req.body.name !== undefined
    ? reqStr(req.body.name, { min: 1, max: 30, label: "菜名" }) : dish.name;
  const emoji = req.body.emoji !== undefined
    ? reqStr(req.body.emoji, { max: 8, label: "表情" }) : dish.emoji;
  const kcal = req.body.kcal !== undefined
    ? reqInt(req.body.kcal, { min: 0, max: 5000, label: "热量" }) : dish.kcal;
  const cat = req.body.cat !== undefined
    ? reqStr(req.body.cat, { max: 12, label: "分类" }) : dish.cat;

  const { rows } = await query(
    `UPDATE dishes SET name = $1, emoji = $2, kcal = $3, cat = $4 WHERE id = $5
     RETURNING id, name, emoji, kcal, cat, created_by`,
    [name, emoji, kcal, cat, dishId]
  );

  // 个人菜改名时级联更新本人黑名单里的菜名
  if (dish.scope_type === "user" && name !== dish.name) {
    await query(
      `UPDATE blacklist SET name = $1 WHERE user_id = $2 AND name = $3`,
      [name, req.uid, dish.name]
    );
  }
  res.json({ dish: rows[0] });
}));

router.delete("/:id", wrap(async (req, res) => {
  const dishId = reqInt(req.params.id, { min: 1, label: "菜品 ID" });
  await canModifyDish(dishId, req.uid);
  await query(`DELETE FROM dishes WHERE id = $1`, [dishId]);
  res.json({ ok: true });
}));

module.exports = router;
