import pool from '../config/db.js';

async function migrateToPhoneAuth() {
    const client = await pool.connect();

    try {
        console.log('🚀 Начало миграции на авторизацию по телефону...');

        // Добавляем новые колонки если их нет
        await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS patronymic VARCHAR(100);
    `);
        console.log('✅ Добавлены колонки first_name, last_name, patronymic');

        // Делаем phone уникальным (если есть данные, нужно убедиться что phone заполнен)
        // Сначала проверяем есть ли пользователи без телефона
        const usersWithoutPhone = await client.query(`
      SELECT id, email, full_name FROM users WHERE phone IS NULL OR phone = ''
    `);

        if (usersWithoutPhone.rows.length > 0) {
            console.log('⚠️ Найдены пользователи без телефона. Генерируем временные номера...');
            for (const user of usersWithoutPhone.rows) {
                const tempPhone = `+998900000${user.id.toString().padStart(3, '0')}`;
                await client.query(`UPDATE users SET phone = $1 WHERE id = $2`, [tempPhone, user.id]);
                console.log(`   Пользователь ${user.full_name} (${user.email}) -> ${tempPhone}`);
            }
        }

        // Заполняем first_name и last_name из full_name
        const usersToUpdate = await client.query(`
      SELECT id, full_name FROM users WHERE first_name IS NULL OR last_name IS NULL
    `);

        for (const user of usersToUpdate.rows) {
            const parts = user.full_name.trim().split(/\s+/);
            let lastName = parts[0] || 'Фамилия';
            let firstName = parts[1] || 'Имя';
            let patronymic = parts.slice(2).join(' ') || null;

            await client.query(`
        UPDATE users SET first_name = $1, last_name = $2, patronymic = $3 WHERE id = $4
      `, [firstName, lastName, patronymic, user.id]);
        }
        console.log(`✅ Обновлено ${usersToUpdate.rows.length} пользователей с разбивкой ФИО`);

        // Делаем phone уникальным
        try {
            await client.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;
      `);
            await client.query(`
        ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);
      `);
            console.log('✅ Телефон сделан уникальным');
        } catch (err) {
            console.log('⚠️ Ограничение уникальности телефона уже существует или ошибка:', err.message);
        }

        // Делаем email необязательным (убираем NOT NULL если есть)
        try {
            await client.query(`
        ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
      `);
            console.log('✅ Email теперь не обязателен');
        } catch (err) {
            console.log('⚠️ Email constraint ошибка:', err.message);
        }

        // Делаем first_name и last_name обязательными
        try {
            await client.query(`
        ALTER TABLE users ALTER COLUMN first_name SET NOT NULL;
      `);
            await client.query(`
        ALTER TABLE users ALTER COLUMN last_name SET NOT NULL;
      `);
            console.log('✅ first_name и last_name теперь обязательны');
        } catch (err) {
            console.log('⚠️ Ошибка установки NOT NULL:', err.message);
        }

        console.log('\n🎉 Миграция завершена успешно!');
        console.log('\n⚠️ ВАЖНО: Обновите телефоны пользователей вручную если были сгенерированы временные!');

    } catch (error) {
        console.error('❌ Ошибка при миграции:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrateToPhoneAuth().catch(console.error);
