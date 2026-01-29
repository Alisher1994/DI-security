import express from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// Получение смен (для админа - все, для сотрудника - только свои)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { role, id: userId } = req.user;
        const { user_id, from_date, to_date } = req.query;

        let query = `
      SELECT 
        s.id, s.shift_date, s.shift_start, s.shift_end, s.is_active, s.created_at,
        u.id as user_id, u.full_name, u.role as user_role, u.email
      FROM shifts s
      JOIN users u ON s.user_id = u.id
      WHERE 1=1
    `;
        const values = [];
        let counter = 1;

        // Если не админ, показываем только свои смены
        if (role !== 'admin') {
            query += ` AND s.user_id = $${counter++}`;
            values.push(userId);
        } else if (user_id) {
            query += ` AND s.user_id = $${counter++}`;
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

        query += ' ORDER BY s.shift_date DESC, s.shift_start DESC';

        const result = await pool.query(query, values);
        res.json({ shifts: result.rows });
    } catch (error) {
        console.error('Ошибка при получении смен:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение текущей активной смены пользователя
router.get('/current', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date();
        const currentDate = now.toISOString().split('T')[0];
        const currentTime = now.toTimeString().split(' ')[0];

        const result = await pool.query(
            `SELECT * FROM shifts 
       WHERE user_id = $1 
       AND shift_date = $2 
       AND shift_start <= $3 
       AND shift_end >= $3 
       AND is_active = true
       LIMIT 1`,
            [userId, currentDate, currentTime]
        );

        if (result.rows.length === 0) {
            return res.json({ shift: null, has_active_shift: false });
        }

        res.json({ shift: result.rows[0], has_active_shift: true });
    } catch (error) {
        console.error('Ошибка при получении текущей смены:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание новой смены (только админ)
router.post('/', [
    authenticateToken,
    authorizeRole('admin'),
    body('user_id').isInt(),
    body('shift_date').isDate(),
    body('shift_start').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
    body('shift_end').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/)
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { user_id, shift_date, shift_start, shift_end } = req.body;

    try {
        // Проверка существования пользователя
        const userCheck = await pool.query(
            'SELECT id, role FROM users WHERE id = $1',
            [user_id]
        );

        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Проверка пересечения смен
        const overlapCheck = await pool.query(
            `SELECT id FROM shifts 
       WHERE user_id = $1 
       AND shift_date = $2 
       AND is_active = true
       AND (
         (shift_start <= $3 AND shift_end >= $3) OR
         (shift_start <= $4 AND shift_end >= $4) OR
         (shift_start >= $3 AND shift_end <= $4)
       )`,
            [user_id, shift_date, shift_start, shift_end]
        );

        if (overlapCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Смена пересекается с существующей сменой' });
        }

        const result = await pool.query(
            'INSERT INTO shifts (user_id, shift_date, shift_start, shift_end) VALUES ($1, $2, $3, $4) RETURNING *',
            [user_id, shift_date, shift_start, shift_end]
        );

        res.status(201).json({
            message: 'Смена успешно создана',
            shift: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при создании смены:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление смены (только админ)
router.put('/:id', [
    authenticateToken,
    authorizeRole('admin'),
    body('shift_date').optional().isDate(),
    body('shift_start').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
    body('shift_end').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
    body('is_active').optional().isBoolean()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { shift_date, shift_start, shift_end, is_active } = req.body;

    try {
        const updates = [];
        const values = [];
        let counter = 1;

        if (shift_date !== undefined) {
            updates.push(`shift_date = $${counter++}`);
            values.push(shift_date);
        }
        if (shift_start !== undefined) {
            updates.push(`shift_start = $${counter++}`);
            values.push(shift_start);
        }
        if (shift_end !== undefined) {
            updates.push(`shift_end = $${counter++}`);
            values.push(shift_end);
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${counter++}`);
            values.push(is_active);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Нет данных для обновления' });
        }

        values.push(id);

        const result = await pool.query(
            `UPDATE shifts SET ${updates.join(', ')} WHERE id = $${counter} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Смена не найдена' });
        }

        res.json({
            message: 'Смена обновлена',
            shift: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при обновлении смены:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление смены (только админ)
router.delete('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM shifts WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Смена не найдена' });
        }

        res.json({ message: 'Смена удалена' });
    } catch (error) {
        console.error('Ошибка при удалении смены:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Массовое создание смен (только админ)
router.post('/bulk', [
    authenticateToken,
    authorizeRole('admin'),
    body('user_id').isInt(),
    body('start_date').isDate(),
    body('end_date').isDate(),
    body('shift_start').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
    body('shift_end').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/),
    body('days_of_week').optional().isArray()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { user_id, start_date, end_date, shift_start, shift_end, days_of_week } = req.body;

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const createdShifts = [];
            const startDateObj = new Date(start_date);
            const endDateObj = new Date(end_date);

            for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
                const dayOfWeek = d.getDay(); // 0 = Вс, 1 = Пн, ..., 6 = Сб

                // Если указаны дни недели, проверяем
                if (days_of_week && days_of_week.length > 0 && !days_of_week.includes(dayOfWeek)) {
                    continue;
                }

                const shiftDate = d.toISOString().split('T')[0];

                // Проверка пересечения
                const overlapCheck = await client.query(
                    `SELECT id FROM shifts 
           WHERE user_id = $1 
           AND shift_date = $2 
           AND is_active = true`,
                    [user_id, shiftDate]
                );

                if (overlapCheck.rows.length === 0) {
                    const result = await client.query(
                        'INSERT INTO shifts (user_id, shift_date, shift_start, shift_end) VALUES ($1, $2, $3, $4) RETURNING *',
                        [user_id, shiftDate, shift_start, shift_end]
                    );
                    createdShifts.push(result.rows[0]);
                }
            }

            await client.query('COMMIT');

            res.status(201).json({
                message: `Создано смен: ${createdShifts.length}`,
                shifts: createdShifts
            });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Ошибка при массовом создании смен:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

export default router;
