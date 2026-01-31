import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';

const router = express.Router();

// Регистрация нового пользователя (только для админа)
router.post('/register', [
    body('phone').trim().notEmpty().withMessage('Телефон обязателен'),
    body('password').isLength({ min: 6 }),
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
            message: 'Пользователь успешно создан',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера при регистрации' });
    }
});

// Вход в систему по телефону
router.post('/login', [
    body('phone').trim().notEmpty().withMessage('Телефон обязателен'),
    body('password').notEmpty()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { phone, password } = req.body;

    try {
        // Поиск пользователя по телефону
        const result = await pool.query(
            'SELECT id, phone, password_hash, first_name, last_name, patronymic, full_name, role, is_active FROM users WHERE phone = $1',
            [phone]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Неверный телефон или пароль' });
        }

        const user = result.rows[0];

        // Проверка активности
        if (user.is_active === false) {
            return res.status(403).json({ error: 'Ваша учетная запись заблокирована. Обратитесь к администратору.' });
        }

        // Проверка пароля
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Неверный телефон или пароль' });
        }

        // Генерация JWT токена
        const token = jwt.sign(
            {
                id: user.id,
                phone: user.phone,
                role: user.role,
                full_name: user.full_name
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Успешный вход в систему',
            token,
            user: {
                id: user.id,
                phone: user.phone,
                first_name: user.first_name,
                last_name: user.last_name,
                patronymic: user.patronymic,
                full_name: user.full_name,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Ошибка при входе:', error);
        res.status(500).json({ error: 'Ошибка сервера при входе' });
    }
});

// Получение информации о текущем пользователе
router.get('/me', async (req, res) => {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Требуется аутентификация' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const result = await pool.query(
            'SELECT id, phone, first_name, last_name, patronymic, full_name, role, created_at FROM users WHERE id = $1',
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Ошибка при получении данных пользователя:', error);
        res.status(403).json({ error: 'Недействительный токен' });
    }
});

export default router;
