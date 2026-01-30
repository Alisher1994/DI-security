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

        let query = 'SELECT id, phone, first_name, last_name, patronymic, full_name, role, created_at FROM users WHERE 1=1';
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
            'SELECT id, phone, first_name, last_name, patronymic, full_name, role, created_at FROM users WHERE id = $1',
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
    body('phone').trim().notEmpty().withMessage('Телефон обязателен'),
    body('password').isLength({ min: 6 }).withMessage('Пароль минимум 6 символов'),
    body('first_name').trim().notEmpty().withMessage('Имя обязательно'),
    body('last_name').trim().notEmpty().withMessage('Фамилия обязательна'),
    body('patronymic').optional().trim(),
    body('role').isIn(['admin', 'kpp', 'patrol'])
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { phone, password, first_name, last_name, patronymic, role } = req.body;

    try {
        // Проверка существующего пользователя
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE phone = $1',
            [phone]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким телефоном уже существует' });
        }

        // Хеширование пароля
        const password_hash = await bcrypt.hash(password, 10);

        // Формируем полное имя
        const full_name = [last_name, first_name, patronymic].filter(Boolean).join(' ');

        // Создание пользователя
        const result = await pool.query(
            'INSERT INTO users (phone, password_hash, first_name, last_name, patronymic, full_name, role) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, phone, first_name, last_name, patronymic, full_name, role, created_at',
            [phone, password_hash, first_name, last_name, patronymic || null, full_name, role]
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
    body('phone').optional().trim().notEmpty(),
    body('first_name').optional().trim().notEmpty(),
    body('last_name').optional().trim().notEmpty(),
    body('patronymic').optional().trim(),
    body('password').optional().isLength({ min: 6 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { role: currentRole, id: currentUserId } = req.user;
    const { phone, first_name, last_name, patronymic, password, role } = req.body;

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

        // Получаем текущие данные пользователя для формирования full_name
        const currentUser = await pool.query('SELECT first_name, last_name, patronymic FROM users WHERE id = $1', [id]);
        if (currentUser.rows.length === 0) {
            return res.status(404).json({ error: 'Сотрудник не найден' });
        }

        const updates = [];
        const values = [];
        let counter = 1;

        const newFirstName = first_name !== undefined ? first_name : currentUser.rows[0].first_name;
        const newLastName = last_name !== undefined ? last_name : currentUser.rows[0].last_name;
        const newPatronymic = patronymic !== undefined ? patronymic : currentUser.rows[0].patronymic;

        if (phone !== undefined) {
            updates.push(`phone = $${counter++}`);
            values.push(phone);
        }
        if (first_name !== undefined) {
            updates.push(`first_name = $${counter++}`);
            values.push(first_name);
        }
        if (last_name !== undefined) {
            updates.push(`last_name = $${counter++}`);
            values.push(last_name);
        }
        if (patronymic !== undefined) {
            updates.push(`patronymic = $${counter++}`);
            values.push(patronymic || null);
        }

        // Обновляем full_name если изменились составляющие
        if (first_name !== undefined || last_name !== undefined || patronymic !== undefined) {
            const full_name = [newLastName, newFirstName, newPatronymic].filter(Boolean).join(' ');
            updates.push(`full_name = $${counter++}`);
            values.push(full_name);
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
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${counter} RETURNING id, phone, first_name, last_name, patronymic, full_name, role, created_at, updated_at`,
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
        COUNT(DISTINCT ps.id) as total_sessions,
        MAX(s.scan_time) as last_scan
      FROM users u
      LEFT JOIN scans s ON u.id = s.user_id
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
