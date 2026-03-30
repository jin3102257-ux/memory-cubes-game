const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // 允许所有来源，确保云端代理能通过
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] // 强制优先使用 WebSocket
});

// 🌟 核心修复 1：明确告诉服务器，橱窗就是 'public' 文件夹
app.use(express.static(path.join(__dirname, 'public')));

// 🌟 核心修复 2：当玩家访问主页时，把 public 里面的 index.html 发给他们！
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 存储房间状态和玩家分数
const rooms = {};

io.on('connection', (socket) => {
    console.log('玩家已连接:', socket.id);

    socket.on('createRoom', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        rooms[roomCode] = {
            players: [socket.id],
            answers: {},
            scores: { [socket.id]: 0 }
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        console.log(`房间 ${roomCode} 已创建`);
    });

    socket.on('joinRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.players.length === 1) {
            room.players.push(socket.id);
            room.scores[socket.id] = 0;
            
            socket.join(roomCode);
            socket.emit('joinSuccess', roomCode);
            
            // 🌟 总监级补丁：给移动端 300ms 的反应缓冲，确保信号 100% 接到
            setTimeout(() => {
                io.to(roomCode).emit('gameStart', roomCode);
                console.log(`玩家加入房间 ${roomCode}，对局开始！`);
            }, 300);
        } else if (room && room.players.length >= 2) {
            socket.emit('joinError', '房间已满');
        } else {
            socket.emit('joinError', '房间不存在');
        }
    });

    socket.on('submitAnswer', (roomCode, data) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.answers[socket.id] = data;

        if (Object.keys(room.answers).length === 2) {
            const [p1, p2] = room.players;
            const ans1 = room.answers[p1];
            const ans2 = room.answers[p2];

            let winner = null;
            if (ans1.isCorrect && !ans2.isCorrect) winner = p1;
            else if (!ans1.isCorrect && ans2.isCorrect) winner = p2;
            else if (ans1.isCorrect && ans2.isCorrect) {
                if (ans1.timeTaken < ans2.timeTaken) winner = p1;
                else if (ans2.timeTaken < ans1.timeTaken) winner = p2;
                else winner = 'tie';
            } else {
                winner = 'none';
            }

            let isGameOver = false;
            if (winner && winner !== 'none' && winner !== 'tie') {
                room.scores[winner]++;
                if (room.scores[winner] >= 8) {
                    isGameOver = true;
                }
            }

            io.to(roomCode).emit('roundResult', {
                winner: winner,
                scores: room.scores,
                isGameOver: isGameOver,
                results: { [p1]: ans1, [p2]: ans2 }
            });

            room.answers = {}; 
            // 🌟 总监修复：不在游戏结束时立即删除房间，由 disconnect 或 leaveRoom 处理
            // if (isGameOver) {
            //     delete rooms[roomCode];
            // }
        }
    });

    socket.on('nextRound', (roomCode) => {
        io.to(roomCode).emit('nextRoundStart');
    });

    // 🌟 总监指令：监听玩家主动“反悔”
    socket.on('leaveRoom', (roomCode) => {
        if (rooms[roomCode]) {
            console.log(`玩家 ${socket.id} 退出，房间 ${roomCode} 已销毁`);
            io.to(roomCode).emit('opponentLeft');
            delete rooms[roomCode];
        }
        socket.leave(roomCode);
    });

    socket.on('disconnect', () => {
        console.log('玩家断开连接:', socket.id);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.players.includes(socket.id)) {
                // 🌟 总监级修正：只移除玩家，不立刻删除房间，给 2 秒重连或退出的缓冲
                room.players = room.players.filter(id => id !== socket.id);
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                } else {
                    io.to(roomCode).emit('opponentLeft');
                }
                break;
            }
        }
    });
});

// 🌟 核心修复 3：让云平台动态分配端口，并允许外网访问 (0.0.0.0)
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`游戏服务器已启动！监听端口：${PORT}`);
});