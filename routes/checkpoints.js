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
        if (existing.rows.length === 0) {
            return code;
        }
        attempts++;
    }
    return Math.floor(10000 + Math.random() * 90000).toString();
}

// Получение всех контрольных точек
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, description, latitude, longitude, radius_meters, qr_code_data, short_code, checkpoint_type, is_active, created_at FROM checkpoints ORDER BY created_at DESC'
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
        const result = await pool.query('SELECT * FROM checkpoints WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Контрольная точка не найдена' });
        res.json({ checkpoint: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание
router.post('/', [
    authenticateToken,
    authorizeRole('admin'),
    body('name').trim().notEmpty(),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    body('radius_meters').optional().isInt({ min: 10, max: 500 }),
    body('checkpoint_type').isIn(['kpp', 'patrol'])
], async (req, res) => {
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

// Обновление
router.put('/:id', [authenticateToken, authorizeRole('admin')], async (req, res) => {
    const { id } = req.params;
    const { name, description, latitude, longitude, radius_meters, is_active } = req.body;
    try {
        const result = await pool.query(
            `UPDATE checkpoints SET name = COALESCE($1, name), description = COALESCE($2, description), latitude = COALESCE($3, latitude), longitude = COALESCE($4, longitude), radius_meters = COALESCE($5, radius_meters), is_active = COALESCE($6, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *`,
            [name, description, latitude, longitude, radius_meters, is_active, id]
        );
        res.json({ message: 'Контрольная точка обновлена', checkpoint: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление
router.delete('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM checkpoints WHERE id = $1', [req.params.id]);
        res.json({ message: 'Контрольная точка удалена' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Простой QR для API
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

// ГЕНЕРАЦИЯ PDF ДЛЯ ПЕЧАТИ
router.get('/:id/qrcode/print', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT qr_code_data, short_code, name, checkpoint_type FROM checkpoints WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдена' });

        const { qr_code_data, short_code, name, checkpoint_type } = result.rows[0];
        const displayCode = short_code || qr_code_data.slice(-4);

        // Создаем PDF документ
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50
        });

        // Настраиваем Response
        const filename = encodeURIComponent(`QR_${displayCode}_${name.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.pdf`);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);

        doc.pipe(res);

        // Проверяем наличие шрифтов
        const hasBold = fs.existsSync(ROBOTO_BOLD);
        const hasRegular = fs.existsSync(ROBOTO_REGULAR);

        // Логотип (текст)
        if (hasBold) doc.font(ROBOTO_BOLD);
        doc.fillColor('#00B14C')
            .fontSize(42)
            .text('DI SECURITY', { align: 'center' });

        doc.moveDown(2);

        // Название локации
        doc.fillColor('#1e293b');
        if (hasBold) doc.font(ROBOTO_BOLD);
        doc.fontSize(36)
            .text(name, { align: 'center', width: 500 });

        doc.moveDown(0.5);

        // Тип точки
        doc.fillColor('#64748b');
        if (hasRegular) doc.font(ROBOTO_REGULAR);
        doc.fontSize(22)
            .text(`Тип: ${checkpoint_type === 'kpp' ? 'КПП' : 'Патруль'}`, { align: 'center' });

        doc.moveDown(2);

        // QR код (генерируем буфер PNG)
        const qrBuffer = await QRCode.toBuffer(qr_code_data, {
            errorCorrectionLevel: 'H',
            margin: 1,
            width: 800 // Высокое разрешение для PDF
        });

        doc.image(qrBuffer, {
            fit: [300, 300],
            align: 'center',
            valign: 'center'
        });

        doc.moveDown(8); // Отступ вниз от QR

        // 4-значный код
        doc.fillColor('#1e293b');
        if (hasBold) doc.font(ROBOTO_BOLD);
        doc.fontSize(84)
            .text(displayCode, { align: 'center' });

        // Подпись
        doc.fillColor('#94a3b8');
        if (hasRegular) doc.font(ROBOTO_REGULAR);
        doc.fontSize(20)
            .text('Код для ручного ввода', { align: 'center' });

        // Футер
        doc.fontSize(16)
            .text('Наведите камеру на QR код или введите код вручную', 50, doc.page.height - 100, { align: 'center' });

        doc.end();

    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).send('Ошибка генерации PDF');
    }
});

export default router;
