const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(cors());

// Koneksi database (Railway akan mengisi DATABASE_URL otomatis)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper tanggal hari ini
function today() {
  return new Date().toISOString().slice(0, 10);
}

// ===== LOGIN =====
app.post("/api/users", async (req, res) => {
  if (req.query.action !== "login") {
    return res.json({ success: false });
  }

  const { username, password, uid } = req.body;
  let user;

  try {
    if (uid) {
      const r = await pool.query("SELECT * FROM users WHERE uid=$1", [uid]);
      user = r.rows[0];
    } else {
      const r = await pool.query(
        "SELECT * FROM users WHERE username=$1 AND password=$2",
        [username, password]
      );
      user = r.rows[0];
    }

    if (!user || user.suspended) {
      return res.json({ success: false, message: "Login ditolak" });
    }

    // reset limit harian
    if (user.last_limit_reset !== today()) {
      await pool.query(
        "UPDATE users SET daily_limit=daily_limit_max, last_limit_reset=$1 WHERE uid=$2",
        [today(), user.uid]
      );
      user.daily_limit = user.daily_limit_max;
    }

    return res.json({
      success: true,
      uid: user.uid,
      username: user.username,
      role: user.role,
      daily_limit: user.daily_limit,
      message: "Login success"
    });
  } catch (e) {
    return res.json({ success: false, message: "Server error" });
  }
});

// ===== ADMIN: CREATE USER =====
app.post("/api/admin", async (req, res) => {
  if (req.query.action !== "create_user") {
    return res.json({ success: false });
  }

  const {
    username,
    password,
    role,
    expiration_date,
    daily_limit,
    device_info
  } = req.body;

  const uid = "UID" + Date.now();

  try {
    await pool.query(
      `INSERT INTO users
      (uid, username, password, role, daily_limit, daily_limit_max, expiration_date, device_info, last_limit_reset)
      VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8)`,
      [uid, username, password, role, daily_limit, expiration_date, device_info, today()]
    );

    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false, message: "Gagal create user" });
  }
});

// ===== SIMPAN HISTORY (KURANGI LIMIT) =====
app.post("/api/sipp_history", async (req, res) => {
  const { uid, kpj, nik, nama, status, source } = req.body;

  try {
    const r = await pool.query("SELECT daily_limit FROM users WHERE uid=$1", [uid]);
    if (!r.rows[0] || r.rows[0].daily_limit <= 0) {
      return res.json({ success: false, message: "Limit harian habis" });
    }

    await pool.query(
      `INSERT INTO sipp_history(uid,kpj,nik,nama,status,source,timestamp)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [uid, kpj, nik, nama, status, source, Date.now()]
    );

    await pool.query(
      "UPDATE users SET daily_limit=daily_limit-1 WHERE uid=$1",
      [uid]
    );

    return res.json({ success: true });
  } catch (e) {
    return res.json({ success: false, message: "Gagal simpan history" });
  }
});

// ===== START SERVER =====
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("API running on port", port);
});
