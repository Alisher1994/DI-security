import pool from '../config/db.js';

async function migrateCheckpoints() {
    const client = await pool.connect();
    try {
        console.log('🚀 Начинаю миграцию контрольных точек...');

        // 1. Добавляем колонку short_code
        await client.query(`
            ALTER TABLE checkpoints 
            ADD COLUMN IF NOT EXISTS short_code VARCHAR(10) UNIQUE;
        `);
        console.log('✅ Колонка short_code добавлена');

        // 2. Генерируем коды для существующих точек
        const result = await client.query('SELECT id FROM checkpoints WHERE short_code IS NULL');
        console.log(`📝 Найдено точек без кода: ${result.rows.length}`);

        for (const row of result.rows) {
            let unique = false;
            let code = '';
            while (!unique) {
                code = Math.floor(1000 + Math.random() * 9000).toString();
                const check = await client.query('SELECT id FROM checkpoints WHERE short_code = $1', [code]);
                if (check.rows.length === 0) unique = true;
            }
            await client.query('UPDATE checkpoints SET short_code = $1 WHERE id = $2', [code, row.id]);
            console.log(`   Точка ID ${row.id} -> Код ${code}`);
        }

        console.log('🎉 Миграция успешно завершена!');
    } catch (err) {
        console.error('❌ Ошибка миграции:', err);
    } finally {
        client.release();
        process.exit();
    }
}

migrateCheckpoints();
