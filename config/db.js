import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Конфигурация подключения к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Установка часового пояса для всех подключений
pool.on('connect', (client) => {
  client.query("SET timezone = 'Asia/Tashkent'");
});

// Тест подключения
pool.on('connect', () => {
  console.log('✅ Подключено к PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ Неожиданная ошибка подключения к БД:', err);
  process.exit(-1);
});

export default pool;
