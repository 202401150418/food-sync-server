const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

if (!process.env.DATABASE_URL) {
  console.error("缺少环境变量 DATABASE_URL，无法连接数据库");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render 内部连接串无需 SSL；外部连接（本地开发连 Render PG）需要
  ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
});

function query(text, params) {
  return pool.query(text, params);
}

// 事务包装：fn 接收 client，成功 commit，异常 rollback
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// 启动时幂等建表 + 播种系统菜品
async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await pool.query(schema);

  const seed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "seed-dishes.json"), "utf8")
  );
  for (const d of seed.dishes) {
    await pool.query(
      `INSERT INTO system_dishes (name, emoji, kcal, cat) VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO NOTHING`,
      [d.name, d.emoji, d.kcal, d.cat]
    );
  }
  console.log(`数据库就绪：系统菜品 ${seed.dishes.length} 道已确认`);
}

module.exports = { pool, query, withTx, migrate };
