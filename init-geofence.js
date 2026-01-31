
import pool from './config/db.js';

async function initGeofenceTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS global_settings (
                key TEXT PRIMARY KEY,
                value JSONB
            );
        `);
        console.log('✅ Таблица global_settings создана или уже существует');

        // Добавим пустое значение для территории, если его нет
        await pool.query(`
            INSERT INTO global_settings (key, value)
            VALUES ('territory_polygon', '[]'::jsonb)
            ON CONFLICT (key) DO NOTHING;
        `);

        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка при создании таблицы:', error);
        process.exit(1);
    }
}

initGeofenceTable();
