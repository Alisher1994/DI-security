import express from 'express';
import QRCode from 'qrcode';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const router = express.Router();

// Генерация уникального 4-значного кода
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

// Эндпоинты API
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM checkpoints ORDER BY created_at DESC');
        res.json({ checkpoints: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM checkpoints WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдена' });
        res.json({ checkpoint: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

router.post('/', [authenticateToken, authorizeRole('admin')], async (req, res) => {
    const { name, description, latitude, longitude, radius_meters, checkpoint_type } = req.body;
    try {
        const shortCode = await generateShortCode();
        const result = await pool.query(
            'INSERT INTO checkpoints (name, description, latitude, longitude, radius_meters, qr_code_data, short_code, checkpoint_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
            [name, description || '', latitude, longitude, radius_meters || 50, shortCode, shortCode, checkpoint_type]
        );
        res.status(201).json({ message: 'Контрольная точка создана', checkpoint: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

router.delete('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
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

// ГЕНЕРАЦИЯ PDF (МАКСИМАЛЬНО ПРОСТАЯ И СТАБИЛЬНАЯ)
router.get('/:id/qrcode/print', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT qr_code_data, short_code, name, checkpoint_type FROM checkpoints WHERE id = $1', [id]);

        if (result.rows.length === 0) return res.status(404).send('Not found');

        const { qr_code_data, short_code, name, checkpoint_type } = result.rows[0];
        const displayCode = short_code || qr_code_data.slice(-4);

        // QR Картинка
        const qrBuffer = await QRCode.toBuffer(qr_code_data, { errorCorrectionLevel: 'H', margin: 1, width: 600 });

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
            const pdfBuffer = Buffer.concat(chunks);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=QR_${displayCode}.pdf`);
            res.send(pdfBuffer);
        });

        // Используем ТОЛЬКО стандартный шрифт Helvetica (он не поддерживает кириллицу, но не ломает сервер)
        doc.fillColor('#00B14C').font('Helvetica-Bold').fontSize(42).text('DI SECURITY', { align: 'center' });
        doc.moveDown(1.5);

        doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(30).text(name, { align: 'center' });
        doc.moveDown(0.5);

        const typeLabel = checkpoint_type === 'kpp' ? 'KPP' : 'Patrol';
        doc.fillColor('#64748b').font('Helvetica').fontSize(20).text(`Type: ${typeLabel}`, { align: 'center' });

        doc.moveDown(2);
        doc.image(qrBuffer, (doc.page.width - 300) / 2, doc.y, { width: 300 });

        doc.moveDown(2);
        doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(80).text(displayCode, { align: 'center' });
        doc.fillColor('#94a3b8').font('Helvetica').fontSize(20).text('Manual Entry Code', { align: 'center' });

        doc.fontSize(14).text('Scan QR or enter code manually', 50, doc.page.height - 80, { align: 'center' });

        doc.end();
    } catch (error) {
        console.error('PDF Error:', error);
        res.status(500).send('Error');
    }
});

export default router;
