import express from 'express';
import QRCode from 'qrcode';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// Получение всех контрольных точек
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, description, latitude, longitude, radius_meters, qr_code_data, checkpoint_type, is_active, created_at FROM checkpoints ORDER BY created_at DESC'
        );
        res.json({ checkpoints: result.rows });
    } catch (error) {
        console.error('Ошибка при получении контрольных точек:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение одной контрольной точки
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM checkpoints WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Контрольная точка не найдена' });
        }

        res.json({ checkpoint: result.rows[0] });
    } catch (error) {
        console.error('Ошибка при получении контрольной точки:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание новой контрольной точки (только админ)
router.post('/', [
    authenticateToken,
    authorizeRole('admin'),
    body('name').trim().notEmpty(),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    body('radius_meters').optional().isInt({ min: 10, max: 500 }),
    body('checkpoint_type').isIn(['kpp', 'patrol'])
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, latitude, longitude, radius_meters, checkpoint_type } = req.body;

    try {
        // Генерация уникального QR кода
        const qrData = `CP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const result = await pool.query(
            'INSERT INTO checkpoints (name, description, latitude, longitude, radius_meters, qr_code_data, checkpoint_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [name, description || '', latitude, longitude, radius_meters || 50, qrData, checkpoint_type]
        );

        res.status(201).json({
            message: 'Контрольная точка создана',
            checkpoint: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при создании контрольной точки:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление контрольной точки (только админ)
router.put('/:id', [
    authenticateToken,
    authorizeRole('admin'),
    body('name').optional().trim().notEmpty(),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    body('radius_meters').optional().isInt({ min: 10, max: 500 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { name, description, latitude, longitude, radius_meters, is_active } = req.body;

    try {
        const updates = [];
        const values = [];
        let counter = 1;

        if (name !== undefined) {
            updates.push(`name = $${counter++}`);
            values.push(name);
        }
        if (description !== undefined) {
            updates.push(`description = $${counter++}`);
            values.push(description);
        }
        if (latitude !== undefined) {
            updates.push(`latitude = $${counter++}`);
            values.push(latitude);
        }
        if (longitude !== undefined) {
            updates.push(`longitude = $${counter++}`);
            values.push(longitude);
        }
        if (radius_meters !== undefined) {
            updates.push(`radius_meters = $${counter++}`);
            values.push(radius_meters);
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${counter++}`);
            values.push(is_active);
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id);

        const result = await pool.query(
            `UPDATE checkpoints SET ${updates.join(', ')} WHERE id = $${counter} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Контрольная точка не найдена' });
        }

        res.json({
            message: 'Контрольная точка обновлена',
            checkpoint: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при обновлении контрольной точки:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление контрольной точки (только админ)
router.delete('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM checkpoints WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Контрольная точка не найдена' });
        }

        res.json({ message: 'Контрольная точка удалена' });
    } catch (error) {
        console.error('Ошибка при удалении контрольной точки:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Генерация QR кода для контрольной точки
router.get('/:id/qrcode', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT qr_code_data, name FROM checkpoints WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Контрольная точка не найдена' });
        }

        const { qr_code_data, name } = result.rows[0];

        // Генерация QR кода в формате Data URL
        const qrCodeDataUrl = await QRCode.toDataURL(qr_code_data, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            quality: 0.95,
            margin: 1,
            width: 512
        });

        res.json({
            qr_code: qrCodeDataUrl,
            name,
            qr_data: qr_code_data
        });
    } catch (error) {
        console.error('Ошибка при генерации QR кода:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

export default router;
