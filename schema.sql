-- 「今天吃什么」数据库结构（启动时幂等执行）

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE "C",
  nickname      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  color         TEXT,
  avatar        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 全局内置菜品目录（由 seed-dishes.json 播种，只插一次）
CREATE TABLE IF NOT EXISTS system_dishes (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL DEFAULT '🍽️',
  kcal  INT  NOT NULL CHECK (kcal >= 0),
  cat   TEXT NOT NULL
);

-- 个人 / 房间的自定义菜品
CREATE TABLE IF NOT EXISTS dishes (
  id         SERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user','room')),
  scope_id   INT  NOT NULL,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL DEFAULT '🍽️',
  kcal       INT  NOT NULL CHECK (kcal >= 0),
  cat        TEXT NOT NULL DEFAULT '自定义',
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, name)
);
CREATE INDEX IF NOT EXISTS idx_dishes_scope ON dishes(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS rooms (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  owner_id    INT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id   INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- 每餐一条记录，items 为 JSONB 快照（与前端记录形状一致）
CREATE TABLE IF NOT EXISTS history (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  BIGINT,
  time       TEXT NOT NULL,
  date       TEXT NOT NULL,
  meal       TEXT NOT NULL CHECK (meal IN ('lunch','dinner')),
  items      JSONB NOT NULL,
  total      INT  NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_history_user_date ON history(user_id, date);

-- 拒吃黑名单（按菜名关联，个人维度）
CREATE TABLE IF NOT EXISTS blacklist (
  user_id INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  PRIMARY KEY (user_id, name)
);
