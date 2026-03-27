const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
            io.to(roomCode).emit('gameStart', roomCode);
            console.log(`玩家加入房间 ${roomCode}，对局开始！`);
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
            if (isGameOver) {
                delete rooms[roomCode];
            }
        }
    });

    socket.on('nextRound', (roomCode) => {
        io.to(roomCode).emit('nextRoundStart');
    });

    socket.on('disconnect', () => {
        console.log('玩家断开连接:', socket.id);
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.players.includes(socket.id)) {
                io.to(roomCode).emit('opponentLeft');
                delete rooms[roomCode]; 
                break;
            }
        }
    });
});

// 使用 3005 端口
const PORT = 3005;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});