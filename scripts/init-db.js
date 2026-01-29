import pool from '../config/db.js';
import bcrypt from 'bcryptjs';

async function initDatabase() {
  const client = await pool.connect();

  try {
    console.log('🚀 Начало инициализации базы данных...');

    // Создание таблицы пользователей
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'kpp', 'patrol')),
        phone VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Таблица users создана');

    // Создание таблицы контрольных точек (QR коды)
    await client.query(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        radius_meters INTEGER DEFAULT 50,
        qr_code_data TEXT UNIQUE NOT NULL,
        checkpoint_type VARCHAR(50) NOT NULL CHECK (checkpoint_type IN ('kpp', 'patrol')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Таблица checkpoints создана');

    // Создание таблицы смен
    await client.query(`
      CREATE TABLE IF NOT EXISTS shifts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        shift_date DATE NOT NULL,
        shift_start TIME NOT NULL,
        shift_end TIME NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, shift_date, shift_start)
      );
    `);
    console.log('✅ Таблица shifts создана');

    // Создание таблицы сканирований
    await client.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        checkpoint_id INTEGER REFERENCES checkpoints(id) ON DELETE CASCADE,
        scan_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        distance_meters DECIMAL(10, 2),
        is_valid BOOLEAN DEFAULT true,
        shift_id INTEGER REFERENCES shifts(id),
        notes TEXT
      );
    `);
    console.log('✅ Таблица scans создана');

    // Создание таблицы GPS треков
    await client.query(`
      CREATE TABLE IF NOT EXISTS gps_tracks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        shift_id INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        accuracy DECIMAL(10, 2),
        speed DECIMAL(10, 2),
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Таблица gps_tracks создана');

    // Создание таблицы активных сессий патрулирования
    await client.query(`
      CREATE TABLE IF NOT EXISTS patrol_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        shift_id INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
        session_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        session_end TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        total_distance_meters DECIMAL(10, 2) DEFAULT 0
      );
    `);
    console.log('✅ Таблица patrol_sessions создана');

    // Создание индексов для оптимизации запросов
    await client.query('CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_scans_checkpoint_id ON scans(checkpoint_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_scans_scan_time ON scans(scan_time);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_gps_tracks_user_id ON gps_tracks(user_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_gps_tracks_recorded_at ON gps_tracks(recorded_at);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_shifts_user_id ON shifts(user_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date);');
    console.log('✅ Индексы созданы');

    // Создание администратора по умолчанию
    const adminPassword = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO users (email, password_hash, full_name, role, phone)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING;
    `, ['admin@example.com', adminPassword, 'Администратор Системы', 'admin', '+7 (999) 999-99-99']);
    console.log('✅ Администратор по умолчанию создан (admin@example.com / admin123)');

    // Создание тестовых данных (опционально)
    const testPassword = await bcrypt.hash('test123', 10);

    // Тестовый КПП сотрудник
    const kppResult = await client.query(`
      INSERT INTO users (email, password_hash, full_name, role, phone)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
      RETURNING id;
    `, ['kpp@example.com', testPassword, 'Иванов Иван (КПП)', 'kpp', '+7 (111) 111-11-11']);

    // Тестовый патруль
    const patrolResult = await client.query(`
      INSERT INTO users (email, password_hash, full_name, role, phone)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
      RETURNING id;
    `, ['patrol@example.com', testPassword, 'Петров Петр (Патруль)', 'patrol', '+7 (222) 222-22-22']);

    console.log('✅ Тестовые пользователи созданы (kpp@example.com / test123 и patrol@example.com / test123)');

    // Создание тестовых контрольных точек (только если таблица пуста)
    const checkCP = await client.query('SELECT id FROM checkpoints LIMIT 1');
    if (checkCP.rows.length === 0) {
      const checkpoints = [
        { name: 'КПП Главный вход', lat: 55.751244, lng: 37.618423, type: 'kpp' },
        { name: 'КПП Восточный', lat: 55.752244, lng: 37.620423, type: 'kpp' },
        { name: 'Точка патруля #1', lat: 55.753244, lng: 37.619423, type: 'patrol' },
        { name: 'Точка патруля #2', lat: 55.750244, lng: 37.617423, type: 'patrol' },
        { name: 'Точка патруля #3', lat: 55.749244, lng: 37.619923, type: 'patrol' }
      ];

      for (const cp of checkpoints) {
        const qrData = `CP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await client.query(`
            INSERT INTO checkpoints (name, description, latitude, longitude, radius_meters, qr_code_data, checkpoint_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (qr_code_data) DO NOTHING;
          `, [cp.name, `Контрольная точка: ${cp.name}`, cp.lat, cp.lng, 50, qrData, cp.type]);
      }
      console.log('✅ Тестовые контрольные точки созданы');
    }

    // Создание тестовых смен (только если таблица пуста)
    const checkShifts = await client.query('SELECT id FROM shifts LIMIT 1');
    if (checkShifts.rows.length === 0) {
      const today = new Date().toISOString().split('T')[0];
      if (kppResult && kppResult.rows.length > 0) {
        await client.query(`
            INSERT INTO shifts (user_id, shift_date, shift_start, shift_end)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING;
          `, [kppResult.rows[0].id, today, '08:00:00', '20:00:00']);
      }

      if (patrolResult && patrolResult.rows.length > 0) {
        await client.query(`
            INSERT INTO shifts (user_id, shift_date, shift_start, shift_end)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING;
          `, [patrolResult.rows[0].id, today, '10:00:00', '22:00:00']);
      }
      console.log('✅ Тестовые смены созданы');
    }

    console.log('\n🎉 Инициализация базы данных завершена успешно!');
    console.log('\n📝 Учетные данные для входа:');
    console.log('   Админ: admin@example.com / admin123');
    console.log('   КПП: kpp@example.com / test123');
    console.log('   Патруль: patrol@example.com / test123\n');

  } catch (error) {
    console.error('❌ Ошибка при инициализации базы данных:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase().catch(console.error);
