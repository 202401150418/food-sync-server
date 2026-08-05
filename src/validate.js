// 极简输入校验器，失败抛带中文信息的 Error，由路由统一 catch

function reqStr(v, { min = 1, max = 200, label = "字段" } = {}) {
  if (typeof v !== "string") throw new Error(`${label}必须是字符串`);
  const s = v.trim();
  if (s.length < min) throw new Error(`${label}不能为空`);
  if (s.length > max) throw new Error(`${label}过长（最多 ${max} 字）`);
  return s;
}

function reqInt(v, { min = 0, max = 100000, label = "数值" } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${label}必须是整数`);
  if (n < min || n > max) throw new Error(`${label}需在 ${min}~${max} 之间`);
  return n;
}

function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isTime(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s);
}

function validMeal(s) {
  if (s !== "lunch" && s !== "dinner") throw new Error("meal 必须是 lunch 或 dinner");
  return s;
}

// 包装路由：把同步/异步异常统一转成 400/500 JSON
function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (e && e.code === "23505") {
        // PG 唯一约束冲突
        return res.status(409).json({ error: "已存在相同数据" });
      }
      const isClientError = e instanceof Error && !e.code;
      res
        .status(isClientError ? 400 : 500)
        .json({ error: isClientError ? e.message : "服务器开小差了" });
      if (!isClientError) console.error(e);
    }
  };
}

module.exports = { reqStr, reqInt, isDate, isTime, validMeal, wrap };
