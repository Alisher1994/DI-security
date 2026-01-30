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

// Получение GPS треков (для админа или своих)
router.get('/tracks', authenticateToken, async (req, res) => {
    try {
        const { role, id: currentUserId } = req.user;
        const { user_id, session_id, from_time, to_time, limit = 1000 } = req.query;

        let query = `
      SELECT 
        g.id, g.latitude, g.longitude, g.accuracy, g.speed, g.recorded_at,
        u.full_name as user_name, u.role as user_role,
        ps.id as session_id, ps.session_start, ps.session_end
      FROM gps_tracks g
      JOIN users u ON g.user_id = u.id
      LEFT JOIN patrol_sessions ps ON g.shift_id = ps.shift_id AND ps.user_id = u.id
      WHERE 1=1
    `;
        const values = [];
        let counter = 1;

        // Если не админ, показываем только свои треки
        if (role !== 'admin') {
            query += ` AND g.user_id = $${counter++}`;
            values.push(currentUserId);
        } else if (user_id) {
            query += ` AND g.user_id = $${counter++}`;
            values.push(user_id);
        }

        if (session_id) {
            query += ` AND ps.id = $${counter++}`;
            values.push(session_id);
        }

        if (from_time) {
            query += ` AND g.recorded_at >= $${counter++}`;
            values.push(from_time);
        }

        if (to_time) {
            query += ` AND g.recorded_at <= $${counter++}`;
            values.push(to_time);
        }

        query += ` ORDER BY g.recorded_at DESC LIMIT $${counter}`;
        values.push(limit);

        const result = await pool.query(query, values);
        res.json({ tracks: result.rows });
    } catch (error) {
        console.error('Ошибка при получении GPS треков:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение активных патрулей (real-time для админа)
router.get('/active', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT DISTINCT ON (u.id)
        u.id, u.full_name, u.role,
        ps.id as session_id, ps.session_start,
        g.latitude, g.longitude, g.accuracy, g.speed, g.recorded_at,
        s.shift_date, s.shift_start, s.shift_end
      FROM users u
      JOIN patrol_sessions ps ON u.id = ps.user_id AND ps.is_active = true
      JOIN shifts s ON ps.shift_id = s.id
      LEFT JOIN gps_tracks g ON u.id = g.user_id AND g.shift_id = s.id
      ORDER BY u.id, g.recorded_at DESC
    `);

        res.json({ active_patrols: result.rows });
    } catch (error) {
        console.error('Ошибка при получении активных патрулей:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение истории сессий патрулирования
router.get('/sessions', authenticateToken, async (req, res) => {
    try {
        const { role, id: currentUserId } = req.user;
        const { user_id, from_date, to_date } = req.query;

        let query = `
      SELECT 
        ps.id, ps.session_start, ps.session_end, ps.is_active, ps.total_distance_meters,
        u.id as user_id, u.full_name, u.role as user_role,
        s.shift_date, s.shift_start as shift_time_start, s.shift_end as shift_time_end,
        COUNT(sc.id) as scan_count
      FROM patrol_sessions ps
      JOIN users u ON ps.user_id = u.id
      JOIN shifts s ON ps.shift_id = s.id
      LEFT JOIN scans sc ON sc.user_id = ps.user_id AND sc.shift_id = ps.shift_id
      WHERE 1=1
    `;
        const values = [];
        let counter = 1;

        if (role !== 'admin') {
            query += ` AND ps.user_id = $${counter++}`;
            values.push(currentUserId);
        } else if (user_id) {
            query += ` AND ps.user_id = $${counter++}`;
            values.push(user_id);
        }

        if (from_date) {
            query += ` AND s.shift_date >= $${counter++}`;
            values.push(from_date);
        }

        if (to_date) {
            query += ` AND s.shift_date <= $${counter++}`;
            values.push(to_date);
        }

        query += ` 
      GROUP BY ps.id, u.id, u.full_name, u.role, s.shift_date, s.shift_start, s.shift_end
      ORDER BY ps.session_start DESC
    `;

        const result = await pool.query(query, values);
        res.json({ sessions: result.rows });
    } catch (error) {
        console.error('Ошибка при получении сессий:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

export default router;
