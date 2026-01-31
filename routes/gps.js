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

            // Проверка активной смены
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

            // Создание новой сессии
            const sessionResult = await client.query(
                'INSERT INTO patrol_sessions (user_id, shift_id) VALUES ($1, $2) RETURNING *',
                [userId, shift.id]
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

        // Сохранение GPS трека
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
        // Получаем всех пользователей, у которых есть либо активная сессия, 
        // либо активность (GPS или сканы) за последние 30 минут
        const result = await pool.query(`
      WITH recent_activity AS (
        -- Последние GPS координаты
        SELECT DISTINCT ON (user_id) 
          user_id, latitude, longitude, accuracy, recorded_at, 'gps' as activity_type
        FROM gps_tracks
        WHERE recorded_at > NOW() - INTERVAL '30 minutes'
        ORDER BY user_id, recorded_at DESC
        
        UNION ALL
        
        -- Последние сканирования
        SELECT DISTINCT ON (user_id)
          user_id, latitude, longitude, 0 as accuracy, scan_time as recorded_at, 'scan' as activity_type
        FROM scans
        WHERE scan_time > NOW() - INTERVAL '30 minutes'
        ORDER BY user_id, scan_time DESC
      ),
      latest_activity AS (
        SELECT DISTINCT ON (user_id) *
        FROM recent_activity
        ORDER BY user_id, recorded_at DESC
      )
      SELECT 
        u.id, u.full_name, u.role,
        ps.id as session_id, ps.session_start, ps.is_active as session_is_active,
        la.latitude, la.longitude, la.accuracy, la.recorded_at, la.activity_type,
        s.shift_date, s.shift_start, s.shift_end
      FROM users u
      LEFT JOIN patrol_sessions ps ON u.id = ps.user_id AND ps.is_active = true
      LEFT JOIN latest_activity la ON u.id = la.user_id
      LEFT JOIN shifts s ON ps.shift_id = s.id
      WHERE (ps.is_active = true OR la.recorded_at IS NOT NULL)
      AND u.role IN ('kpp', 'patrol')
    `);

        res.json({ active_patrols: result.rows });
    } catch (error) {
        console.error('Ошибка при получении активных патрулей:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

export default router;
