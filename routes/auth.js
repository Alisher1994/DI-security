import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import pool from '../config/db.js';

const router = express.Router();

// Регистрация нового пользователя (только для админа)
router.post('/register', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('full_name').trim().notEmpty(),
    body('role').isIn(['admin', 'kpp', 'patrol']),
    body('phone').optional().trim()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, full_name, role, phone } = req.body;

    try {
        // Проверка существующего пользователя
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        // Хеширование пароля
        const password_hash = await bcrypt.hash(password, 10);

        // Создание пользователя
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, full_name, role, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, role, phone, created_at',
            [email, password_hash, full_name, role, phone]
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

// Вход в систему
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
        // Поиск пользователя
        const result = await pool.query(
            'SELECT id, email, password_hash, full_name, role, phone FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        const user = result.rows[0];

        // Проверка пароля
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        // Генерация JWT токена
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
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
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                phone: user.phone
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
            'SELECT id, email, full_name, role, phone, created_at FROM users WHERE id = $1',
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
