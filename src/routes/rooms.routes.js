const express = require("express");
const crypto = require("crypto");
const { query, withTx } = require("../db");
const { authRequired } = require("../auth");
const { reqStr, reqInt, isDate, wrap } = require("../validate");

const router = express.Router();
router.use(authRequired);

// 6 位邀请码（去掉易混淆字符）
function genInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(6);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

async function roomWithMembers(roomId) {
  const room = (await query(`SELECT * FROM rooms WHERE id = $1`, [roomId])).rows[0];
  if (!room) return null;
  const members = (await query(
    `SELECT u.id, u.username, u.nickname, u.color, u.avatar
     FROM room_members m JOIN users u ON u.id = m.user_id
     WHERE m.room_id = $1 ORDER BY m.joined_at`,
    [roomId]
  )).rows;
  return {
    id: room.id,
    name: room.name,
    invite_code: room.invite_code,
    owner_id: room.owner_id,
    members,
  };
}

async function mustBeMember(roomId, uid) {
  const { rows } = await query(
    `SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2`,
    [roomId, uid]
  );
  if (!rows.length) throw Object.assign(new Error("你不是这个房间的成员"), { status: 403 });
}

router.post("/", wrap(async (req, res) => {
  const name = reqStr(req.body.name, { min: 1, max: 24, label: "房间名" });
  const room = await withTx(async (client) => {
    // 邀请码撞车概率极低，重试 5 次兜底
    for (let i = 0; i < 5; i++) {
      try {
        const { rows } = await client.query(
          `INSERT INTO rooms (name, invite_code, owner_id) VALUES ($1, $2, $3) RETURNING id`,
          [name, genInviteCode(), req.uid]
        );
        await client.query(
          `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)`,
          [rows[0].id, req.uid]
        );
        return rows[0];
      } catch (e) {
        if (e.code !== "23505") throw e;
      }
    }
    throw new Error("邀请码生成失败，请重试");
  });
  res.json({ room: await roomWithMembers(room.id) });
}));

router.post("/join", wrap(async (req, res) => {
  const code = reqStr(req.body.invite_code, { min: 6, max: 6, label: "邀请码" }).toUpperCase();
  const { rows } = await query(`SELECT id FROM rooms WHERE invite_code = $1`, [code]);
  if (!rows[0]) return res.status(404).json({ error: "邀请码不对，没有找到这个房间" });
  try {
    await query(
      `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)`,
      [rows[0].id, req.uid]
    );
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "你已经在这个房间里啦" });
    throw e;
  }
  res.json({ room: await roomWithMembers(rows[0].id) });
}));

// 回房间：凭历史成员记录直接回原房间，无需邀请码
router.post("/:id/rejoin", wrap(async (req, res) => {
  const roomId = reqInt(req.params.id, { min: 1, label: "房间 ID" });
  const { rows } = await query(
    `SELECT 1 FROM room_history WHERE room_id = $1 AND user_id = $2`,
    [roomId, req.uid]
  );
  if (!rows.length) throw Object.assign(new Error("你没有加入过这个房间"), { status: 403 });
  await query(
    `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)
     ON CONFLICT (room_id, user_id) DO NOTHING`,
    [roomId, req.uid]
  );
  // 回房间后清掉历史记录（已是现成员）
  await query(`DELETE FROM room_history WHERE room_id = $1 AND user_id = $2`, [roomId, req.uid]);
  res.json({ room: await roomWithMembers(roomId) });
}));

// 我加入过的房间（含已退出的，标注 left_at）
router.get("/history", wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.name, h.left_at,
            (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) AS member_count
     FROM room_history h JOIN rooms r ON r.id = h.room_id
     WHERE h.user_id = $1
     ORDER BY h.left_at DESC`,
    [req.uid]
  );
  res.json({ rooms: rows });
}));

router.get("/", wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT room_id FROM room_members WHERE user_id = $1 ORDER BY joined_at`, [req.uid]
  );
  const rooms = [];
  for (const r of rows) rooms.push(await roomWithMembers(r.room_id));
  res.json({ rooms });
}));

router.get("/:id/members", wrap(async (req, res) => {
  const roomId = reqInt(req.params.id, { min: 1, label: "房间 ID" });
  await mustBeMember(roomId, req.uid);
  const room = await roomWithMembers(roomId);
  res.json({ members: room.members });
}));

router.post("/:id/leave", wrap(async (req, res) => {
  const roomId = reqInt(req.params.id, { min: 1, label: "房间 ID" });
  await mustBeMember(roomId, req.uid);
  await withTx(async (client) => {
    await client.query(
      `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, req.uid]
    );
    // 留痕：之后可以凭此记录随时回来
    await client.query(
      `INSERT INTO room_history (room_id, user_id) VALUES ($1, $2)
       ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = now()`,
      [roomId, req.uid]
    );
    const left = (await client.query(
      `SELECT user_id FROM room_members WHERE room_id = $1 ORDER BY joined_at`, [roomId]
    )).rows;
    if (!left.length) {
      // 没人了：连房间带房间菜一起删
      await client.query(`DELETE FROM dishes WHERE scope_type = 'room' AND scope_id = $1`, [roomId]);
      await client.query(`DELETE FROM rooms WHERE id = $1`, [roomId]);
    } else {
      // 房主走了：移交给最早加入的成员
      await client.query(
        `UPDATE rooms SET owner_id = $1 WHERE id = $2 AND owner_id = $3`,
        [left[0].user_id, roomId, req.uid]
      );
    }
  });
  res.json({ ok: true });
}));

// 房主移出成员
router.post("/:id/kick", wrap(async (req, res) => {
  const roomId = reqInt(req.params.id, { min: 1, label: "房间 ID" });
  const targetUid = reqInt(req.body.user_id, { min: 1, label: "成员 ID" });
  const { rows } = await query(`SELECT owner_id FROM rooms WHERE id = $1`, [roomId]);
  if (!rows[0]) throw Object.assign(new Error("房间不存在"), { status: 404 });
  if (rows[0].owner_id !== req.uid) throw Object.assign(new Error("只有房主能移出成员"), { status: 403 });
  if (targetUid === req.uid) throw new Error("不能移出自己，要退出请用「退出」");

  const member = await query(
    `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2 RETURNING user_id`,
    [roomId, targetUid]
  );
  if (!member.rows.length) throw Object.assign(new Error("对方不在这个房间"), { status: 404 });
  // 留痕：被移出的人凭历史记录可以自己回来
  await query(
    `INSERT INTO room_history (room_id, user_id) VALUES ($1, $2)
     ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = now()`,
    [roomId, targetUid]
  );
  res.json({ ok: true });
}));

// 饭桌视图：房间成员某天的干饭情况
router.get("/:id/table", wrap(async (req, res) => {
  const roomId = reqInt(req.params.id, { min: 1, label: "房间 ID" });
  await mustBeMember(roomId, req.uid);
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  if (!isDate(date)) throw new Error("date 格式应为 YYYY-MM-DD");

  const { rows } = await query(
    `SELECT u.id AS uid, u.nickname, u.color, u.avatar,
            h.id, h.time, h.meal, h.items, h.total
     FROM room_members m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN history h ON h.user_id = u.id AND h.date = $2
     WHERE m.room_id = $1
     ORDER BY m.joined_at, h.id`,
    [roomId, date]
  );

  const diners = new Map();
  for (const r of rows) {
    if (!diners.has(r.uid)) {
      diners.set(r.uid, {
        user: { id: r.uid, nickname: r.nickname, color: r.color, avatar: r.avatar },
        recs: [],
        total: 0,
      });
    }
    if (r.id) {
      const d = diners.get(r.uid);
      d.recs.push({ id: r.id, time: r.time, meal: r.meal, items: r.items, total: r.total });
      d.total += r.total;
    }
  }
  res.json({ date, diners: [...diners.values()] });
}));

module.exports = router;
