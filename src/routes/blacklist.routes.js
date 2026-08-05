const express = require("express");
const { query, withTx } = require("../db");
const { authRequired } = require("../auth");
const { wrap } = require("../validate");

const router = express.Router();
router.use(authRequired);

router.get("/", wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT name FROM blacklist WHERE user_id = $1 ORDER BY name`, [req.uid]
  );
  res.json({ blacklist: rows.map((r) => r.name) });
}));

// 全量替换（与前端「保存整个列表」的模式一致）
router.put("/", wrap(async (req, res) => {
  const list = req.body.blacklist;
  if (!Array.isArray(list) || list.length > 500) throw new Error("blacklist 格式不对");
  const names = [...new Set(list.map((n) => String(n || "").trim()).filter(Boolean))];

  await withTx(async (client) => {
    await client.query(`DELETE FROM blacklist WHERE user_id = $1`, [req.uid]);
    for (const name of names) {
      await client.query(
        `INSERT INTO blacklist (user_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.uid, name.slice(0, 30)]
      );
    }
  });
  res.json({ blacklist: names });
}));

module.exports = router;
