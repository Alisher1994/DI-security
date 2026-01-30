import express from 'express';
import QRCode from 'qrcode';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const router = express.Router();

// Генератор короткого кода
async function generateShortCode() {
    let attempts = 0;
    while (attempts < 100) {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        const existing = await pool.query('SELECT id FROM checkpoints WHERE short_code = $1', [code]);
        if (existing.rows.length === 0) return code;
        attempts++;
    }
    return Math.floor(10000 + Math.random() * 90000).toString();
}

// Получение всех точек
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM checkpoints ORDER BY created_at DESC');
        res.json({ checkpoints: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение одной точки (важно для редактирования!)
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM checkpoints WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдена' });
        res.json({ checkpoint: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание точки
router.post('/', [authenticateToken, authorizeRole('admin')], async (req, res) => {
    const { name, description, latitude, longitude, radius_meters, checkpoint_type } = req.body;
    try {
        const shortCode = await generateShortCode();
        const result = await pool.query(
            'INSERT INTO checkpoints (name, description, latitude, longitude, radius_meters, qr_code_data, short_code, checkpoint_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
            [name, description || '', latitude, longitude, radius_meters || 50, shortCode, shortCode, checkpoint_type]
        );
        res.status(201).json({ checkpoint: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление точки (важно для сохранения правок!)
router.put('/:id', [authenticateToken, authorizeRole('admin')], async (req, res) => {
    const { id } = req.params;
    const { name, description, latitude, longitude, radius_meters, checkpoint_type, is_active } = req.body;
    try {
        const result = await pool.query(
            `UPDATE checkpoints 
             SET name = COALESCE($1, name), 
                 description = COALESCE($2, description), 
                 latitude = COALESCE($3, latitude), 
                 longitude = COALESCE($4, longitude), 
                 radius_meters = COALESCE($5, radius_meters), 
                 checkpoint_type = COALESCE($6, checkpoint_type),
                 is_active = COALESCE($7, is_active),
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = $8 RETURNING *`,
            [name, description, latitude, longitude, radius_meters, checkpoint_type, is_active, id]
        );
        res.json({ message: 'Обновлено', checkpoint: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление точки
router.delete('/:id', [authenticateToken, authorizeRole('admin')], async (req, res) => {
    try {
        await pool.query('DELETE FROM checkpoints WHERE id = $1', [req.params.id]);
        res.json({ message: 'Удалено' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

router.get('/:id/qrcode', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT qr_code_data, short_code, name FROM checkpoints WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдена' });
        const { qr_code_data, short_code, name } = result.rows[0];
        const qrCodeDataUrl = await QRCode.toDataURL(qr_code_data, { width: 512 });
        res.json({ qr_code: qrCodeDataUrl, name, short_code: short_code || qr_code_data });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ГЕНЕРАЦИЯ ДАННЫХ ДЛЯ ПЕЧАТНОЙ СТРАНИЦЫ
router.get('/:id/print-data', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM checkpoints WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдена' });

        const cp = result.rows[0];
        const qrCodeDataUrl = await QRCode.toDataURL(cp.qr_code_data, {
            width: 1000,
            margin: 1,
            color: { dark: '#1e293b', light: '#ffffff' }
        });

        res.json({
            name: cp.name,
            shortCode: cp.short_code || cp.qr_code_data.slice(-4),
            type: cp.checkpoint_type === 'kpp' ? 'КПП' : 'Патруль',
            qrCode: qrCodeDataUrl
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
