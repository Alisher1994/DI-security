import express from 'express';
import { body, validationResult } from 'express-validator';
import { getDistance } from 'geolib';
import pool from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Получение истории сканирований (для админа - все, для сотрудника - только свои)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { role, id: userId } = req.user;
        const { from_date, to_date, user_id, checkpoint_id, limit = 100 } = req.query;

        let query = `
      SELECT 
        s.id, s.scan_time, s.latitude, s.longitude, s.distance_meters, s.is_valid, s.notes,
        u.id as user_id, u.full_name as user_name, u.role as user_role,
        c.name as checkpoint_name, c.checkpoint_type,
        sh.shift_date, sh.shift_start, sh.shift_end
      FROM scans s
      JOIN users u ON s.user_id = u.id
      JOIN checkpoints c ON s.checkpoint_id = c.id
      LEFT JOIN shifts sh ON s.shift_id = sh.id
      WHERE 1=1
    `;
        const values = [];
        let counter = 1;

        // Если не админ, показываем только свои сканирования
        if (role !== 'admin') {
            query += ` AND s.user_id = $${counter++}`;
            values.push(userId);
        } else if (user_id && user_id !== 'undefined') {
            query += ` AND s.user_id = $${counter++}`;
            values.push(user_id);
        }

        if (checkpoint_id) {
            query += ` AND s.checkpoint_id = $${counter++}`;
            values.push(checkpoint_id);
        }

        if (from_date) {
            query += ` AND s.scan_time >= $${counter++}`;
            values.push(from_date);
        }

        if (to_date) {
            query += ` AND s.scan_time <= $${counter++}`;
            values.push(to_date);
        }

        query += ` ORDER BY s.scan_time DESC LIMIT $${counter}`;
        values.push(limit);

        const result = await pool.query(query, values);
        res.json({ scans: result.rows });
    } catch (error) {
        console.error('Ошибка при получении сканирований:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Сканирование QR кода
router.post('/scan', [
    authenticateToken,
    body('qr_code_data').trim().notEmpty(),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { qr_code_data, latitude, longitude, notes } = req.body;
    const userId = req.user.id;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Поиск контрольной точки по QR коду или short_code
        const checkpointResult = await client.query(
            'SELECT * FROM checkpoints WHERE (qr_code_data = $1 OR short_code = $1) AND is_active = true',
            [qr_code_data]
        );

        if (checkpointResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'QR код не найден или неактивен' });
        }

        const checkpoint = checkpointResult.rows[0];

        // Проверка расстояния (геофенсинг)
        const distance = getDistance(
            { latitude, longitude },
            { latitude: parseFloat(checkpoint.latitude), longitude: parseFloat(checkpoint.longitude) }
        );

        const isWithinRadius = distance <= checkpoint.radius_meters;

        if (!isWithinRadius) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Вы находитесь слишком далеко от контрольной точки',
                distance_meters: distance,
                required_radius: checkpoint.radius_meters
            });
        }

        // Запись сканирования (без привязки к смене)
        const scanResult = await client.query(
            `INSERT INTO scans (user_id, checkpoint_id, latitude, longitude, distance_meters, is_valid, shift_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
            [userId, checkpoint.id, latitude, longitude, distance, isWithinRadius, null, notes || null]
        );

        await client.query('COMMIT');

        res.status(201).json({
            message: 'QR код успешно отсканирован',
            scan: scanResult.rows[0],
            checkpoint: {
                name: checkpoint.name,
                type: checkpoint.checkpoint_type
            },
            distance_meters: distance
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при сканировании QR кода:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
        client.release();
    }
});

// Получение статистики сканирований (для админа)
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const { from_date, to_date } = req.query;

        let query = `
      SELECT 
        COUNT(*) as total_scans,
        COUNT(DISTINCT user_id) as active_users,
        COUNT(DISTINCT checkpoint_id) as scanned_checkpoints,
        AVG(distance_meters) as avg_distance,
        COUNT(CASE WHEN is_valid = true THEN 1 END) as valid_scans,
        COUNT(CASE WHEN is_valid = false THEN 1 END) as invalid_scans
      FROM scans
      WHERE 1=1
    `;
        const values = [];
        let counter = 1;

        if (from_date) {
            query += ` AND scan_time >= $${counter++}`;
            values.push(from_date);
        }

        if (to_date) {
            query += ` AND scan_time <= $${counter++}`;
            values.push(to_date);
        }

        const result = await pool.query(query, values);

        // Статистика по пользователям
        const userStatsQuery = `
      SELECT 
        u.id, u.full_name, u.role,
        COUNT(s.id) as scan_count,
        MAX(s.scan_time) as last_scan
      FROM users u
      LEFT JOIN scans s ON u.id = s.user_id
      ${from_date ? 'AND s.scan_time >= $1' : ''}
      ${to_date ? (from_date ? 'AND s.scan_time <= $2' : 'AND s.scan_time <= $1') : ''}
      WHERE u.role IN ('kpp', 'patrol')
      GROUP BY u.id, u.full_name, u.role
      ORDER BY scan_count DESC
    `;

        const userStats = await pool.query(userStatsQuery, values);

        res.json({
            stats: result.rows[0],
            user_stats: userStats.rows
        });
    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

export default router;
