import express from 'express';
import QRCode from 'qrcode';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const fontsPath = path.join(__dirname, '../fonts');
const ROBOTO_BOLD = path.join(fontsPath, 'Roboto-Bold.ttf');
const ROBOTO_REGULAR = path.join(fontsPath, 'Roboto-Regular.ttf');

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

router.put('/:id', [authenticateToken, authorizeRole('admin')], async (req, res) => {
    const { id } = req.params;
    const { name, description, latitude, longitude, radius_meters, is_active } = req.body;
    try {
        const result = await pool.query(
            `UPDATE checkpoints SET name = COALESCE($1, name), description = COALESCE($2, description), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
            [name, description, id]
        );
        res.json({ message: 'Обновлено', checkpoint: result.rows[0] });
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

// ГЕНЕРАЦИЯ PDF (УЛУЧШЕННАЯ)
router.get('/:id/qrcode/print', authenticateToken, async (req, res) => {
    console.log(`[PDF] Request received for CP ID: ${req.params.id}`);

    try {
        const { id } = req.params;
        const result = await pool.query('SELECT qr_code_data, short_code, name, checkpoint_type FROM checkpoints WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            console.log(`[PDF] Checkpoint ${id} not found`);
            return res.status(404).send('Checkpoint not found');
        }

        const { qr_code_data, short_code, name, checkpoint_type } = result.rows[0];
        const displayCode = short_code || qr_code_data.slice(-4);

        console.log(`[PDF] Data fetched: ${name}, Code: ${displayCode}`);

        // Генерируем QR буфер заранее
        const qrBuffer = await QRCode.toBuffer(qr_code_data, {
            errorCorrectionLevel: 'H',
            margin: 1,
            width: 600
        });
        console.log(`[PDF] QR Buffer generated`);

        // Создаем PDF в памяти
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
            console.log(`[PDF] Document generation finished, sending result...`);
            const pdfBuffer = Buffer.concat(chunks);

            const safeName = name.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');
            const filename = `QR_${displayCode}_${safeName}.pdf`;

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
            res.send(pdfBuffer);
        });

        // Проверка шрифтов
        const hasBold = fs.existsSync(ROBOTO_BOLD) && fs.statSync(ROBOTO_BOLD).size > 1000;
        const hasReg = fs.existsSync(ROBOTO_REGULAR) && fs.statSync(ROBOTO_REGULAR).size > 1000;

        // Рисуем контент
        doc.fillColor('#00B14C');
        if (hasBold) doc.font(ROBOTO_BOLD); else doc.font('Helvetica-Bold');
        doc.fontSize(42).text('DI SECURITY', { align: 'center' });

        doc.moveDown(1.5);

        doc.fillColor('#1e293b');
        if (hasBold) doc.font(ROBOTO_BOLD); else doc.font('Helvetica-Bold');
        doc.fontSize(36).text(name, { align: 'center' });

        doc.moveDown(0.5);

        doc.fillColor('#64748b');
        if (hasReg) doc.font(ROBOTO_REGULAR); else doc.font('Helvetica');
        doc.fontSize(22).text(`Тип: ${checkpoint_type === 'kpp' ? 'КПП' : 'Патруль'}`, { align: 'center' });

        doc.moveDown(2);

        // QR Картинка
        const qrSize = 300;
        doc.image(qrBuffer, (doc.page.width - qrSize) / 2, doc.y, { width: qrSize });

        doc.moveDown(1.5);

        doc.fillColor('#1e293b');
        if (hasBold) doc.font(ROBOTO_BOLD); else doc.font('Helvetica-Bold');
        doc.fontSize(84).text(displayCode, { align: 'center' });

        doc.fillColor('#94a3b8');
        if (hasReg) doc.font(ROBOTO_REGULAR); else doc.font('Helvetica');
        doc.fontSize(20).text('Код для ручного ввода', { align: 'center' });

        doc.fontSize(16).text('Сканируйте QR или введите код вручную', 50, doc.page.height - 80, { align: 'center' });

        doc.end();

    } catch (error) {
        console.error('[PDF] Fatal Error:', error);
        if (!res.headersSent) {
            res.status(500).send('Error generating PDF: ' + error.message);
        }
    }
});

export default router;
