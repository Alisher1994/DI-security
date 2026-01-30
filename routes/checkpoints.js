import express from 'express';
import QRCode from 'qrcode';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { createCanvas, loadImage, registerFont } from 'canvas';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// БЕЗОПАСНАЯ РЕГИСТРАЦИЯ ШРИФТОВ
const fontsPath = path.join(__dirname, '../fonts');
let hasRoboto = false;

function safeRegisterFont(fileName, family, weight) {
    try {
        const fullPath = path.join(fontsPath, fileName);
        if (fs.existsSync(fullPath)) {
            const stats = fs.statSync(fullPath);
            console.log(`📑 Checking font ${fileName}: ${stats.size} bytes`);

            if (stats.size < 1000) {
                console.warn(`⚠️ Font ${fileName} seems too small/corrupt`);
                return false;
            }

            registerFont(fullPath, { family, weight });
            console.log(`✅ Font ${family} (${weight}) registered successfully`);
            return true;
        } else {
            console.warn(`⚠️ Font file not found: ${fullPath}`);
        }
    } catch (err) {
        console.error(`❌ Non-critical error registering font ${family}:`, err.message);
    }
    return false;
}

// Пробуем зарегистрировать оба начертания
const boldOk = safeRegisterFont('Roboto-Bold.ttf', 'Roboto', 'bold');
const regOk = safeRegisterFont('Roboto-Regular.ttf', 'Roboto', 'regular');
hasRoboto = boldOk || regOk;

const router = express.Router();

// Используем Roboto если загрузился, иначе стандартный санс-сериф
const FONT_BOLD = hasRoboto ? 'bold 36px Roboto' : 'bold 36px sans-serif';
const FONT_REGULAR = hasRoboto ? '16px Roboto' : '16px sans-serif';

// ... (остальные функции остаются без изменений, но используют переменные FONT_*)

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

// PUT
router.put('/:id', [authenticateToken, authorizeRole('admin')], async (req, res) => {
    const { id } = req.params;
    const { name, description, latitude, longitude, radius_meters, is_active } = req.body;
    try {
        const result = await pool.query(
            `UPDATE checkpoints SET name = COALESCE($1, name), description = COALESCE($2, description), latitude = COALESCE($3, latitude), longitude = COALESCE($4, longitude), radius_meters = COALESCE($5, radius_meters), is_active = COALESCE($6, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *`,
            [name, description, latitude, longitude, radius_meters, is_active, id]
        );
        res.json({ message: 'Конводная точка обновлена', checkpoint: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// DELETE
router.delete('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM checkpoints WHERE id = $1', [req.params.id]);
        res.json({ message: 'Контрольная точка удалена' });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Простой QR
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

// ПЕЧАТНАЯ ФОРМА
router.get('/:id/qrcode/print', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT qr_code_data, short_code, name, checkpoint_type FROM checkpoints WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не найдена' });

        const { qr_code_data, short_code, name, checkpoint_type } = result.rows[0];
        const displayCode = short_code || qr_code_data.slice(-4);

        const width = 595;
        const height = 842;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        // Лого
        ctx.fillStyle = '#00B14C';
        ctx.font = hasRoboto ? 'bold 42px Roboto' : 'bold 42px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('DI SECURITY', width / 2, 95);

        // Название
        ctx.fillStyle = '#1e293b';
        ctx.font = hasRoboto ? 'bold 36px Roboto' : 'bold 36px sans-serif';
        const maxWidth = width - 80;
        const words = name.split(' ');
        let lines = [];
        let curLine = '';
        for (const w of words) {
            const test = curLine ? curLine + ' ' + w : w;
            if (ctx.measureText(test).width > maxWidth) { lines.push(curLine); curLine = w; } else { curLine = test; }
        }
        lines.push(curLine);
        lines.forEach((l, i) => ctx.fillText(l, width / 2, 180 + i * 45));

        // Тип
        ctx.font = hasRoboto ? '22px Roboto' : '22px sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText(`Тип: ${checkpoint_type === 'kpp' ? 'КПП' : 'Патруль'}`, width / 2, 180 + lines.length * 45 + 20);

        // QR
        const qrSize = 300;
        const qrBuffer = await QRCode.toBuffer(qr_code_data, { errorCorrectionLevel: 'H', width: qrSize });
        const qrImage = await loadImage(qrBuffer);
        ctx.drawImage(qrImage, (width - qrSize) / 2, 350, qrSize, qrSize);

        // Код
        ctx.fillStyle = '#1e293b';
        ctx.font = hasRoboto ? 'bold 84px Roboto' : 'bold 84px sans-serif';
        ctx.fillText(displayCode, width / 2, 730);

        ctx.fillStyle = '#94a3b8';
        ctx.font = hasRoboto ? '20px Roboto' : '20px sans-serif';
        ctx.fillText('Код для ручного ввода', width / 2, 775);

        ctx.font = hasRoboto ? '16px Roboto' : '16px sans-serif';
        ctx.fillText('Наведите камеру на QR код или введите код вручную', width / 2, height - 50);

        const buffer = canvas.toBuffer('image/png');
        const filename = encodeURIComponent(`qr_${displayCode}_${name.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.png`);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
        res.send(buffer);
    } catch (error) {
        console.error('Print error:', error);
        res.status(500).json({ error: 'Ошибка генерации' });
    }
});

export default router;
