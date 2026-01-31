import express from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import multer from 'multer';
import * as XLSX from 'xlsx';

const router = express.Router();

// Настройка multer для загрузки файлов в память
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Только Excel файлы (.xlsx, .xls)'), false);
        }
    }
});

// Получение списка всех сотрудников (только админ)
router.get('/', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { role } = req.query;

        let query = 'SELECT id, phone, first_name, last_name, patronymic, full_name, role, is_active, created_at FROM users WHERE 1=1';
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
    const { phone, first_name, last_name, patronymic, password, role, is_active } = req.body;

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
        if (is_active !== undefined && currentRole === 'admin') {
            updates.push(`is_active = $${counter++}`);
            values.push(is_active);
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

// Экспорт сотрудников в XLSX
router.get('/export/xlsx', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, phone, first_name, last_name, patronymic, full_name, role, created_at 
            FROM users 
            ORDER BY id
        `);

        // Подготовка данных для Excel
        const data = result.rows.map(emp => ({
            'ID': emp.id,
            'Фамилия': emp.last_name,
            'Имя': emp.first_name,
            'Отчество': emp.patronymic || '',
            'ФИО': emp.full_name,
            'Телефон': emp.phone,
            'Роль': emp.role === 'admin' ? 'Администратор' : emp.role === 'kpp' ? 'КПП' : 'Патруль',
            'Дата создания': new Date(emp.created_at).toLocaleDateString('ru-RU')
        }));

        // Создание книги Excel
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Сотрудники');

        // Настройка ширины столбцов
        worksheet['!cols'] = [
            { wch: 5 },  // ID
            { wch: 15 }, // Фамилия
            { wch: 15 }, // Имя
            { wch: 15 }, // Отчество
            { wch: 30 }, // ФИО
            { wch: 18 }, // Телефон
            { wch: 15 }, // Роль
            { wch: 15 }  // Дата создания
        ];

        // Генерация буфера
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=employees_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);
    } catch (error) {
        console.error('Ошибка при экспорте сотрудников:', error);
        res.status(500).json({ error: 'Ошибка экспорта' });
    }
});

// Скачать шаблон для импорта
router.get('/import/template', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        // Создаем шаблон с примером
        const templateData = [
            {
                'Фамилия': 'Иванов',
                'Имя': 'Иван',
                'Отчество': 'Иванович',
                'Телефон': '+998901234567',
                'Роль (kpp/patrol/admin)': 'kpp',
                'Пароль': 'password123'
            },
            {
                'Фамилия': 'Петрова',
                'Имя': 'Мария',
                'Отчество': '',
                'Телефон': '+998909876543',
                'Роль (kpp/patrol/admin)': 'patrol',
                'Пароль': 'securepass'
            }
        ];

        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Шаблон');

        worksheet['!cols'] = [
            { wch: 15 }, // Фамилия
            { wch: 15 }, // Имя
            { wch: 15 }, // Отчество
            { wch: 18 }, // Телефон
            { wch: 25 }, // Роль
            { wch: 15 }  // Пароль
        ];

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=import_template.xlsx');
        res.send(buffer);
    } catch (error) {
        console.error('Ошибка при создании шаблона:', error);
        res.status(500).json({ error: 'Ошибка создания шаблона' });
    }
});

// Импорт сотрудников из XLSX
router.post('/import/xlsx', authenticateToken, authorizeRole('admin'), upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }

        // Читаем Excel файл
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
            return res.status(400).json({ error: 'Файл пустой или некорректный формат' });
        }

        const results = {
            success: [],
            errors: []
        };

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const rowNum = i + 2; // +2 потому что первая строка - заголовки, и нумерация с 1

            try {
                // Получаем данные из строки (поддержка разных вариантов названий колонок)
                const lastName = row['Фамилия'] || row['last_name'] || row['LastName'];
                const firstName = row['Имя'] || row['first_name'] || row['FirstName'];
                const patronymic = row['Отчество'] || row['patronymic'] || row['Patronymic'] || '';
                let phone = row['Телефон'] || row['phone'] || row['Phone'] || '';
                const roleRaw = row['Роль (kpp/patrol/admin)'] || row['Роль'] || row['role'] || row['Role'] || '';
                const password = row['Пароль'] || row['password'] || row['Password'] || '';

                // Валидация
                if (!lastName || !firstName) {
                    results.errors.push({ row: rowNum, error: 'Фамилия и Имя обязательны' });
                    continue;
                }

                if (!phone) {
                    results.errors.push({ row: rowNum, error: 'Телефон обязателен' });
                    continue;
                }

                // Нормализация телефона
                phone = phone.toString().replace(/\s/g, '');
                if (!phone.startsWith('+')) {
                    phone = '+' + phone;
                }
                if (!phone.startsWith('+998')) {
                    phone = '+998' + phone.replace(/^\+/, '');
                }

                // Определение роли
                let role = roleRaw.toLowerCase().trim();
                if (role === 'администратор') role = 'admin';
                else if (role === 'кпп') role = 'kpp';
                else if (role === 'патруль') role = 'patrol';

                if (!['admin', 'kpp', 'patrol'].includes(role)) {
                    results.errors.push({ row: rowNum, error: `Некорректная роль: ${roleRaw}. Допустимые: kpp, patrol, admin` });
                    continue;
                }

                if (!password || password.length < 6) {
                    results.errors.push({ row: rowNum, error: 'Пароль должен быть минимум 6 символов' });
                    continue;
                }

                // Проверка существования пользователя
                const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
                if (existing.rows.length > 0) {
                    results.errors.push({ row: rowNum, error: `Пользователь с телефоном ${phone} уже существует` });
                    continue;
                }

                // Создаем пользователя
                const passwordHash = await bcrypt.hash(password, 10);
                const fullName = [lastName, firstName, patronymic].filter(Boolean).join(' ');

                await pool.query(`
                    INSERT INTO users (phone, password_hash, first_name, last_name, patronymic, full_name, role)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [phone, passwordHash, firstName, lastName, patronymic || null, fullName, role]);

                results.success.push({
                    row: rowNum,
                    name: fullName,
                    phone: phone
                });

            } catch (rowError) {
                results.errors.push({ row: rowNum, error: rowError.message });
            }
        }

        res.json({
            message: `Импорт завершен. Успешно: ${results.success.length}, Ошибок: ${results.errors.length}`,
            results
        });

    } catch (error) {
        console.error('Ошибка при импорте сотрудников:', error);
        res.status(500).json({ error: 'Ошибка импорта: ' + error.message });
    }
});

export default router;
