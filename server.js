import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import routes
import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import checkpointRoutes from './routes/checkpoints.js';
import scanRoutes from './routes/scans.js';
import shiftRoutes from './routes/shifts.js';
import gpsRoutes from './routes/gps.js';

// ES Module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/checkpoints', checkpointRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/gps', gpsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Система мониторинга охраны работает',
        timestamp: new Date().toISOString()
    });
});

// Serve frontend HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Маршрут не найден' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err.stack);
    res.status(500).json({
        error: 'Внутренняя ошибка сервера',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║  🛡️  Система Мониторинга Охраны и Патрулирования        ║
║                                                           ║
║  ✅ Сервер запущен на порту: ${PORT}                         ║
║  🌐 URL: http://localhost:${PORT}                          ║
║  👤 Админ-панель: http://localhost:${PORT}/admin           ║
║  📱 Приложение сотрудника: http://localhost:${PORT}        ║
║                                                           ║
║  🔐 Учетные данные по умолчанию:                         ║
║     Админ: admin@example.com / admin123                  ║
║     КПП: kpp@example.com / test123                       ║
║     Патруль: patrol@example.com / test123                ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
