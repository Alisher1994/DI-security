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

import { createServer } from 'http';
import { Server } from 'socket.io';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Socket.io Walkie-Talkie Logic
io.on('connection', (socket) => {
    console.log('📱 Новое подключение по Socket.io:', socket.id);

    // Присоединение к голосовому каналу
    socket.on('join-channel', (channelId) => {
        // Уходим из всех предыдущих комнат кроме своей личной
        const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
        rooms.forEach(r => socket.leave(r));

        socket.join(channelId);
        console.log(`👤 Пользователь ${socket.id} вошел в канал: ${channelId}`);
    });

    // Трансляция аудио чанка всем в комнате кроме отправителя
    socket.on('audio-chunk', (data) => {
        // data.channelId, data.chunk, data.senderName
        socket.to(data.channelId).emit('audio-broadcast', {
            chunk: data.chunk,
            senderName: data.senderName,
            senderId: socket.id
        });
    });

    // Уведомление о начале/конце передачи (для индикации в UI)
    socket.on('ptt-start', (data) => {
        socket.to(data.channelId).emit('ptt-active', {
            senderName: data.senderName,
            active: true
        });
    });

    socket.on('ptt-stop', (data) => {
        socket.to(data.channelId).emit('ptt-active', {
            active: false
        });
    });

    socket.on('disconnect', () => {
        console.log('❌ Пользователь отключился:', socket.id);
    });
});

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
httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║  🛡️  Система Мониторинга Охраны и Патрулирования        ║
║                                                           ║
║  ✅ Сервер запущен на порту: ${PORT}                         ║
║  📡 WebSocket (Walkie-Talkie) активен                     ║
║  🌐 URL: http://localhost:${PORT}                          ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
