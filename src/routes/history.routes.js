const express = require("express");
const { query } = require("../db");
const { authRequired } = require("../auth");
const { reqInt, isDate, isTime, validMeal, wrap } = require("../validate");

const router = express.Router();
router.use(authRequired);

function validItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 30) {
    throw new Error("items 格式不对");
  }
  return items.map((i) => ({
    name: String(i.name || "").slice(0, 30),
    emoji: String(i.emoji || "🍽️").slice(0, 8),
    kcal: reqInt(i.kcal, { min: 0, max: 5000, label: "热量" }),
    qty: reqInt(i.qty || 1, { min: 1, max: 20, label: "数量" }),
  }));
}

router.get("/", wrap(async (req, res) => {
  const params = [req.uid];
  let where = `WHERE user_id = $1`;
  if (req.query.date) {
    if (!isDate(req.query.date)) throw new Error("date 格式应为 YYYY-MM-DD");
    params.push(req.query.date);
    where += ` AND date = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT id, client_id, time, date, meal, items, total FROM history
     ${where} ORDER BY id DESC LIMIT 500`,
    params
  );
  res.json({ history: rows });
}));

router.post("/", wrap(async (req, res) => {
  if (!isTime(req.body.time)) throw new Error("time 格式应为 YYYY-MM-DD HH:MM");
  if (!isDate(req.body.date)) throw new Error("date 格式应为 YYYY-MM-DD");
  const meal = validMeal(req.body.meal);
  const items = validItems(req.body.items);
  const total = reqInt(req.body.total, { min: 0, max: 100000, label: "总热量" });
  const clientId = req.body.client_id ? reqInt(req.body.client_id, { min: 1, label: "client_id" }) : null;

  // client_id 冲突（重复提交/迁移重放）时返回已存在记录，保持幂等
  const { rows } = await query(
    `INSERT INTO history (user_id, client_id, time, date, meal, items, total)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, client_id) DO NOTHING
     RETURNING id, client_id, time, date, meal, items, total`,
    [req.uid, clientId, req.body.time, req.body.date, meal, JSON.stringify(items), total]
  );
  if (rows[0]) return res.json({ record: rows[0] });

  const existing = await query(
    `SELECT id, client_id, time, date, meal, items, total FROM history
     WHERE user_id = $1 AND client_id = $2`,
    [req.uid, clientId]
  );
  res.json({ record: existing.rows[0] });
}));

router.delete("/:id", wrap(async (req, res) => {
  const id = reqInt(req.params.id, { min: 1, label: "记录 ID" });
  await query(`DELETE FROM history WHERE id = $1 AND user_id = $2`, [id, req.uid]);
  res.json({ ok: true });
}));

router.delete("/", wrap(async (req, res) => {
  await query(`DELETE FROM history WHERE user_id = $1`, [req.uid]);
  res.json({ ok: true });
}));

module.exports = router;
