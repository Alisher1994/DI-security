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

// Стандартные API роуты
router.get('/', authenticateToken, async (req, res) => {
    const result = await pool.query('SELECT * FROM checkpoints ORDER BY created_at DESC');
    res.json({ checkpoints: result.rows });
});

router.post('/', [authenticateToken, authorizeRole('admin')], async (req, res) => {
    const { name, description, latitude, longitude, radius_meters, checkpoint_type } = req.body;
    const shortCode = await generateShortCode();
    const result = await pool.query(
        'INSERT INTO checkpoints (name, description, latitude, longitude, radius_meters, qr_code_data, short_code, checkpoint_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
        [name, description || '', latitude, longitude, radius_meters || 50, shortCode, shortCode, checkpoint_type]
    );
    res.status(201).json({ checkpoint: result.rows[0] });
});

router.get('/:id/qrcode', authenticateToken, async (req, res) => {
    const result = await pool.query('SELECT qr_code_data, short_code, name FROM checkpoints WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдена' });
    const { qr_code_data, short_code, name } = result.rows[0];
    const qrCodeDataUrl = await QRCode.toDataURL(qr_code_data, { width: 512 });
    res.json({ qr_code: qrCodeDataUrl, name, short_code: short_code || qr_code_data });
});

// НОВЫЙ ПОДХОД: ГЕНЕРАЦИЯ ДАННЫХ ДЛЯ ПЕЧАТНОЙ СТРАНИЦЫ
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
