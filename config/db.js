import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Конфигурация подключения к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Тест подключения
pool.on('connect', async (client) => {
  console.log('✅ Подключено к PostgreSQL');
  try {
    await client.query("SET timezone = 'Asia/Tashkent'");
  } catch (err) {
    console.error('Ошибка установки часового пояса:', err);
  }
});

pool.on('error', (err) => {
  console.error('❌ Неожиданная ошибка подключения к БД:', err);
  process.exit(-1);
});

export default pool;
