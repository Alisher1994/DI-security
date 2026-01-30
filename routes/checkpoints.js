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

// Регистрируем шрифты для поддержки кириллицы на Linux
const fontsPath = path.join(__dirname, '../fonts');
if (fs.existsSync(path.join(fontsPath, 'Roboto-Bold.ttf'))) {
    registerFont(path.join(fontsPath, 'Roboto-Bold.ttf'), { family: 'Roboto', weight: 'bold' });
    registerFont(path.join(fontsPath, 'Roboto-Regular.ttf'), { family: 'Roboto', weight: 'regular' });
}

const router = express.Router();

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
    // Если не удалось найти уникальный, генерируем более длинный
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
        // Генерация уникального QR кода и short_code
        const shortCode = await generateShortCode();
        const qrData = shortCode; // Теперь QR содержит только short_code

        const result = await pool.query(
            'INSERT INTO checkpoints (name, description, latitude, longitude, radius_meters, qr_code_data, short_code, checkpoint_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
            [name, description || '', latitude, longitude, radius_meters || 50, qrData, shortCode, checkpoint_type]
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

// Генерация простого QR кода (для API)
router.get('/:id/qrcode', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT qr_code_data, short_code, name FROM checkpoints WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Контрольная точка не найдена' });
        }

        const { qr_code_data, short_code, name } = result.rows[0];

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
            short_code: short_code || qr_code_data,
            qr_data: qr_code_data
        });
    } catch (error) {
        console.error('Ошибка при генерации QR кода:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Генерация QR кода для печати (книжный формат A4)
router.get('/:id/qrcode/print', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT qr_code_data, short_code, name, checkpoint_type FROM checkpoints WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Контрольная точка не найдена' });
        }

        const { qr_code_data, short_code, name, checkpoint_type } = result.rows[0];
        const displayCode = short_code || qr_code_data.slice(-4);

        // Размеры A4 в портретной ориентации (72 DPI для веба, масштабируем)
        const width = 595;   // A4 width
        const height = 842;  // A4 height

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Белый фон
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        // Загружаем логотип SVG (конвертируем в PNG через canvas нельзя напрямую)
        // Используем текстовый логотип вместо SVG
        const logoHeight = 80;
        const logoY = 50;

        // Рисуем текстовый логотип (пока нет PNG версии)
        ctx.fillStyle = '#00B14C';
        ctx.font = 'bold 42px Roboto';
        ctx.textAlign = 'center';
        ctx.fillText('DI SECURITY', width / 2, logoY + 45);

        // Название локации
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 36px Roboto';
        ctx.textAlign = 'center';

        // Разбиваем длинные названия на строки
        const maxWidth = width - 80;
        const words = name.split(' ');
        let lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine);

        const nameY = logoY + logoHeight + 60;
        lines.forEach((line, i) => {
            ctx.fillText(line, width / 2, nameY + i * 40);
        });

        // Тип точки
        const typeY = nameY + lines.length * 40 + 20;
        ctx.fillStyle = '#64748b';
        ctx.font = '22px Roboto';
        const typeLabel = checkpoint_type === 'kpp' ? 'КПП' : 'Патруль';
        ctx.fillText(`Тип: ${typeLabel}`, width / 2, typeY);

        // QR код
        const qrSize = 300;
        const qrY = typeY + 50;
        const qrX = (width - qrSize) / 2;

        // Генерируем QR код
        const qrBuffer = await QRCode.toBuffer(qr_code_data, {
            errorCorrectionLevel: 'H',
            type: 'png',
            margin: 2,
            width: qrSize,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        const qrImage = await loadImage(qrBuffer);
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

        // 4-значный код
        const codeY = qrY + qrSize + 65;
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 84px Roboto';
        ctx.textAlign = 'center';
        ctx.fillText(displayCode, width / 2, codeY);

        // Подпись под кодом
        ctx.fillStyle = '#94a3b8';
        ctx.font = '20px Roboto';
        ctx.fillText('Код для ручного ввода', width / 2, codeY + 40);

        // Нижняя информация
        const bottomY = height - 50;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '16px Roboto';
        ctx.fillText('Наведите камеру на QR код или введите код вручную', width / 2, bottomY);

        // Отправляем изображение
        const buffer = canvas.toBuffer('image/png');

        // Кодируем имя файла для поддержки кириллицы
        const safeName = name.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');
        const filename = `qr_${displayCode}_${safeName}.png`;

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.send(buffer);

    } catch (error) {
        console.error('Ошибка при генерации QR кода для печати:', error);
        res.status(500).json({ error: 'Ошибка генерации: ' + error.message });
    }
});

export default router;
