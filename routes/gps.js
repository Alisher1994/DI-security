import express from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// Функция для гарантированного создания таблицы (авто-миграция)
async function ensureSettingsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS global_settings (
                key TEXT PRIMARY KEY,
                value JSONB
            );
        `);
        // Проверяем наличие записи для территории
        await pool.query(`
            INSERT INTO global_settings (key, value)
            VALUES ('territory_polygon', '[]'::jsonb)
            ON CONFLICT (key) DO NOTHING;
        `);
        console.log('✅ Таблица настроек проверена и готова к работе');
    } catch (err) {
        console.error('❌ Ошибка при инициализации таблицы настроек:', err.message);
    }
}

// Запускаем проверку при загрузке модуля
ensureSettingsTable();
router.post('/session/start', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            /* Проверка активной смены отключена по просьбе пользователя
            const now = new Date();
            const currentDate = now.toLocaleDateString('en-CA');
            const currentTime = now.toLocaleTimeString('en-GB', { hour12: false });

            const shiftResult = await client.query(
                `SELECT * FROM shifts 
         WHERE user_id = $1 
         AND shift_date = $2 
         AND shift_start <= $3 
         AND shift_end >= $3 
         AND is_active = true
         LIMIT 1`,
                [userId, currentDate, currentTime]
            );

            if (shiftResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'У вас нет активной смены' });
            }

            const shift = shiftResult.rows[0];
            */
            const shiftId = null; // Смена больше не обязательна

            // Проверка существующей активной сессии
            const existingSession = await client.query(
                'SELECT id FROM patrol_sessions WHERE user_id = $1 AND is_active = true',
                [userId]
            );

            if (existingSession.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'У вас уже есть активная сессия патрулирования',
                    session_id: existingSession.rows[0].id
                });
            }

            // Создание новой сессии без привязки к обязательной смене
            const sessionResult = await client.query(
                'INSERT INTO patrol_sessions (user_id, shift_id) VALUES ($1, $2) RETURNING *',
                [userId, shiftId]
            );

            await client.query('COMMIT');

            res.status(201).json({
                message: 'Сессия патрулирования начата',
                session: sessionResult.rows[0]
            });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Ошибка при начале сессии:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Завершение сессии патрулирования
router.post('/session/end', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `UPDATE patrol_sessions 
       SET session_end = CURRENT_TIMESTAMP, is_active = false 
       WHERE user_id = $1 AND is_active = true 
       RETURNING *`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Активная сессия не найдена' });
        }

        res.json({
            message: 'Сессия патрулирования завершена',
            session: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при завершении сессии:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение сессий пользователя
router.get('/sessions', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { active_only } = req.query;

    try {
        let query = 'SELECT * FROM patrol_sessions WHERE user_id = $1';
        const params = [userId];

        if (active_only === 'true') {
            query += ' AND is_active = true';
        }

        query += ' ORDER BY session_start DESC';

        const result = await pool.query(query, params);
        res.json({ sessions: result.rows });
    } catch (error) {
        console.error('Ошибка получения сессий:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отправка GPS координат
router.post('/track', [
    authenticateToken,
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    body('accuracy').optional().isFloat({ min: 0 }),
    body('speed').optional().isFloat({ min: 0 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { latitude, longitude, accuracy, speed } = req.body;
    const userId = req.user.id;

    try {
        // Проверка активной сессии
        const sessionResult = await pool.query(
            'SELECT id FROM patrol_sessions WHERE user_id = $1 AND is_active = true LIMIT 1',
            [userId]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(400).json({ error: 'Нет активной сессии патрулирования' });
        }

        const session = sessionResult.rows[0];

        // Сохранение GPS трека (shift_id теперь опционален)
        const result = await pool.query(
            `INSERT INTO gps_tracks (user_id, shift_id, latitude, longitude, accuracy, speed) 
       VALUES ($1, (SELECT shift_id FROM patrol_sessions WHERE id = $2), $3, $4, $5, $6) 
       RETURNING *`,
            [userId, session.id, latitude, longitude, accuracy || null, speed || null]
        );

        res.status(201).json({
            message: 'GPS координаты сохранены',
            track: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при сохранении GPS трека:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение активных патрулей (real-time для админа)
router.get('/active', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        // Получаем территорию максимально безопасно
        let polygon = [];
        try {
            const territoryResult = await pool.query("SELECT value::text FROM global_settings WHERE key = 'territory_polygon'");
            if (territoryResult.rows.length > 0 && territoryResult.rows[0].value) {
                const rawValue = territoryResult.rows[0].value;
                polygon = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
            }
        } catch (e) {
            console.error('⚠️ Ошибка при чтении полигона из БД:', e.message);
            polygon = []; // Продолжаем работу без фильтрации, если БД недоступна
        }

        const result = await pool.query(`
      SELECT DISTINCT ON (u.id)
        u.id, u.full_name, u.role,
        ps.id as session_id, ps.session_start,
        g.latitude, g.longitude, g.accuracy, g.speed, g.recorded_at,
        s.shift_date, s.shift_start, s.shift_end
      FROM users u
      INNER JOIN patrol_sessions ps ON u.id = ps.user_id AND ps.is_active = true
      LEFT JOIN shifts s ON ps.shift_id = s.id
      LEFT JOIN gps_tracks g ON u.id = g.user_id
      ORDER BY u.id, g.recorded_at DESC NULLS LAST
    `);

        let activePatrols = result.rows;

        // Фильтрация (только если полигон валиден)
        if (Array.isArray(polygon) && polygon.length >= 3) {
            activePatrols = activePatrols.filter(patrol => {
                if (patrol.latitude === null || patrol.longitude === null) return true;

                try {
                    return isPointInPolygon(
                        [parseFloat(patrol.latitude), parseFloat(patrol.longitude)],
                        polygon
                    );
                } catch (e) {
                    console.error('Ошибка гео-фильтрации для юзера:', patrol.id, e);
                    return true;
                }
            });
        }

        res.json({ active_patrols: activePatrols });
    } catch (error) {
        console.error('❌ Ошибка /api/gps/active:', error);
        res.status(500).json({ error: 'Сервер: ' + error.message });
    }
});

// Хелпер для проверки точки в полигоне
function isPointInPolygon(point, polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return true;

    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = parseFloat(polygon[i][0]), yi = parseFloat(polygon[i][1]);
        const xj = parseFloat(polygon[j][0]), yj = parseFloat(polygon[j][1]);

        if (isNaN(xi) || isNaN(yi) || isNaN(xj) || isNaN(yj)) continue;

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Получение настроек территории
router.get('/territory', authenticateToken, async (req, res) => {
    console.log('📡 Запрос на получение территории. Пользователь:', req.user.id);
    try {
        const result = await pool.query("SELECT value::text FROM global_settings WHERE key = 'territory_polygon'");
        let polygon = [];
        if (result.rows.length > 0 && result.rows[0].value) {
            const rawValue = result.rows[0].value;
            polygon = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
            console.log('✅ Территория получена. Точек:', polygon.length);
        } else {
            console.log('ℹ️ Территория в базе отсутствует (пустой массив)');
        }
        res.json({ polygon: Array.isArray(polygon) ? polygon : [] });
    } catch (error) {
        console.error('❌ Ошибка /api/gps/territory (GET):', error.message);
        res.status(500).json({ error: 'БД Ошибка: ' + error.message });
    }
});

// Сохранение настроек территории
router.post('/territory', authenticateToken, authorizeRole('admin'), async (req, res) => {
    const { polygon } = req.body;
    console.log('💾 Попытка сохранения территории. Точек:', polygon?.length, 'Админ:', req.user.id);
    try {
        if (!Array.isArray(polygon)) {
            return res.status(400).json({ error: 'Полигон должен быть массивом' });
        }

        // Сохраняем как JSONB, используя типизацию PostgreSQL
        await pool.query(
            "INSERT INTO global_settings (key, value) VALUES ('territory_polygon', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = $1::jsonb",
            [JSON.stringify(polygon)]
        );

        console.log('✅ Территория успешно сохранена в базу');
        res.json({ message: 'Территория успешно сохранена', polygon });
    } catch (error) {
        console.error('❌ Ошибка /api/gps/territory (POST):', error.message);
        res.status(500).json({ error: 'Ошибка сохранения: ' + error.message });
    }
});

export default router;
