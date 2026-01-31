import express from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// Начало сессии патрулирования
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
        // Проверка таблицы настроек
        let polygon = [];
        try {
            const territoryResult = await pool.query("SELECT value FROM global_settings WHERE key = 'territory_polygon'");
            if (territoryResult.rows.length > 0) {
                polygon = territoryResult.rows[0].value;
                // Если данные пришли в виде строки, парсим их
                if (typeof polygon === 'string') polygon = JSON.parse(polygon);
            }
        } catch (e) {
            console.warn('⚠️ Таблица global_settings не найдена или пуста:', e.message);
        }

        // Оптимизированный запрос: берем последнюю точку трека для каждого активного патруля
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

        // Если полигон задан, фильтруем сотрудников вне зоны
        if (Array.isArray(polygon) && polygon.length >= 3) {
            activePatrols = activePatrols.filter(patrol => {
                // Если у патрульного нет координат, он считается "в процессе загрузки" и отображается
                if (patrol.latitude === null || patrol.longitude === null) return true;

                try {
                    return isPointInPolygon(
                        [parseFloat(patrol.latitude), parseFloat(patrol.longitude)],
                        polygon
                    );
                } catch (e) {
                    console.error('Ошибка проверки полигона для юзера:', patrol.id, e);
                    return true;
                }
            });
        }

        res.json({ active_patrols: activePatrols });
    } catch (error) {
        console.error('Ошибка при получении активных патрулей:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
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

// Получение настроек территории (полигона)
router.get('/territory', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM global_settings WHERE key = 'territory_polygon'");
        let polygon = result.rows.length > 0 ? result.rows[0].value : [];

        // Гарантируем, что возвращаем массив, даже если в БД лежит строка
        if (typeof polygon === 'string') {
            try {
                polygon = JSON.parse(polygon);
            } catch (e) {
                console.error('Ошибка парсинга полигона из БД:', e);
                polygon = [];
            }
        }

        res.json({ polygon: Array.isArray(polygon) ? polygon : [] });
    } catch (error) {
        console.error('Ошибка при получении территории:', error);
        res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
    }
});

// Сохранение настроек территории (только админ)
router.post('/territory', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { polygon } = req.body;
        if (!Array.isArray(polygon)) {
            return res.status(400).json({ error: 'Полигон должен быть массивом координат' });
        }

        // При работе с JSONB в pg-node лучше передавать объект напрямую, 
        // но для надежности здесь мы гарантируем валидный JSON
        await pool.query(
            "INSERT INTO global_settings (key, value) VALUES ('territory_polygon', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [JSON.stringify(polygon)]
        );

        res.json({ message: 'Территория успешно сохранена', polygon });
    } catch (error) {
        console.error('Ошибка при сохранении территории:', error);
        res.status(500).json({ error: 'Ошибка сервера сохранение: ' + error.message });
    }
});

export default router;
