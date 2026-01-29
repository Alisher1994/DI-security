import express from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// Получение списка всех сотрудников (только админ)
router.get('/', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { role } = req.query;

        let query = 'SELECT id, email, full_name, role, phone, created_at FROM users WHERE 1=1';
        const values = [];
        let counter = 1;

        if (role) {
            query += ` AND role = $${counter++}`;
            values.push(role);
        }

        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, values);
        res.json({ employees: result.rows });
    } catch (error) {
        console.error('Ошибка при получении сотрудников:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение одного сотрудника
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { role, id: currentUserId } = req.user;

        // Не админ может получить только свои данные
        if (role !== 'admin' && parseInt(id) !== currentUserId) {
            return res.status(403).json({ error: 'Недостаточно прав доступа' });
        }

        const result = await pool.query(
            'SELECT id, email, full_name, role, phone, created_at FROM users WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Сотрудник не найден' });
        }

        res.json({ employee: result.rows[0] });
    } catch (error) {
        console.error('Ошибка при получении сотрудника:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание нового сотрудника (только админ)
router.post('/', [
    authenticateToken,
    authorizeRole('admin'),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('full_name').trim().notEmpty(),
    body('role').isIn(['admin', 'kpp', 'patrol']),
    body('phone').optional().trim()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, full_name, role, phone } = req.body;

    try {
        // Проверка существующего пользователя
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        // Хеширование пароля
        const password_hash = await bcrypt.hash(password, 10);

        // Создание пользователя
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, full_name, role, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, role, phone, created_at',
            [email, password_hash, full_name, role, phone]
        );

        res.status(201).json({
            message: 'Сотрудник успешно создан',
            employee: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при создании сотрудника:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление сотрудника
router.put('/:id', [
    authenticateToken,
    body('email').optional().isEmail().normalizeEmail(),
    body('full_name').optional().trim().notEmpty(),
    body('phone').optional().trim(),
    body('password').optional().isLength({ min: 6 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { role: currentRole, id: currentUserId } = req.user;
    const { email, full_name, phone, password, role } = req.body;

    try {
        // Не админ может обновить только свои данные (и не может изменить роль)
        if (currentRole !== 'admin') {
            if (parseInt(id) !== currentUserId) {
                return res.status(403).json({ error: 'Недостаточно прав доступа' });
            }
            if (role !== undefined) {
                return res.status(403).json({ error: 'Вы не можете изменить свою роль' });
            }
        }

        const updates = [];
        const values = [];
        let counter = 1;

        if (email !== undefined) {
            updates.push(`email = $${counter++}`);
            values.push(email);
        }
        if (full_name !== undefined) {
            updates.push(`full_name = $${counter++}`);
            values.push(full_name);
        }
        if (phone !== undefined) {
            updates.push(`phone = $${counter++}`);
            values.push(phone);
        }
        if (password !== undefined) {
            const password_hash = await bcrypt.hash(password, 10);
            updates.push(`password_hash = $${counter++}`);
            values.push(password_hash);
        }
        if (role !== undefined && currentRole === 'admin') {
            updates.push(`role = $${counter++}`);
            values.push(role);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Нет данных для обновления' });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id);

        const result = await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${counter} RETURNING id, email, full_name, role, phone, created_at, updated_at`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Сотрудник не найден' });
        }

        res.json({
            message: 'Данные сотрудника обновлены',
            employee: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при обновлении сотрудника:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление сотрудника (только админ)
router.delete('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;

        // Защита от удаления самого себя
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ error: 'Вы не можете удалить свою учетную запись' });
        }

        const result = await pool.query(
            'DELETE FROM users WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Сотрудник не найден' });
        }

        res.json({ message: 'Сотрудник удален' });
    } catch (error) {
        console.error('Ошибка при удалении сотрудника:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение статистики сотрудника
router.get('/:id/stats', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { role, id: currentUserId } = req.user;

        // Не админ может получить только свою статистику
        if (role !== 'admin' && parseInt(id) !== currentUserId) {
            return res.status(403).json({ error: 'Недостаточно прав доступа' });
        }

        // Общая статистика
        const statsResult = await pool.query(`
      SELECT 
        COUNT(DISTINCT s.id) as total_scans,
        COUNT(DISTINCT sh.id) as total_shifts,
        COUNT(DISTINCT ps.id) as total_sessions,
        MAX(s.scan_time) as last_scan
      FROM users u
      LEFT JOIN scans s ON u.id = s.user_id
      LEFT JOIN shifts sh ON u.id = sh.user_id
      LEFT JOIN patrol_sessions ps ON u.id = ps.user_id
      WHERE u.id = $1
      GROUP BY u.id
    `, [id]);

        // Статистика по последним 30 дням
        const recentStatsResult = await pool.query(`
      SELECT 
        COUNT(s.id) as scans_last_30_days
      FROM scans s
      WHERE s.user_id = $1 
      AND s.scan_time >= CURRENT_DATE - INTERVAL '30 days'
    `, [id]);

        res.json({
            stats: {
                ...statsResult.rows[0],
                ...recentStatsResult.rows[0]
            }
        });
    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

export default router;
