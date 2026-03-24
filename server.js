const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 托管前端静态文件
app.use(express.static(path.join(__dirname, '')));

// 存储房间状态和玩家分数
const rooms = {};

io.on('connection', (socket) => {
    console.log('玩家已连接:', socket.id);

    // 玩家创建房间
    socket.on('createRoom', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        // 🌟 新增：初始化 scores 记分板
        rooms[roomCode] = {
            players: [socket.id],
            answers: {},
            scores: { [socket.id]: 0 }
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        console.log(`房间 ${roomCode} 已创建`);
    });

    // 玩家加入房间
    socket.on('joinRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.players.length === 1) {
            room.players.push(socket.id);
            // 🌟 新增：初始化加入者的分数
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

    // 接收玩家交卷并结算
    socket.on('submitAnswer', (roomCode, data) => {
        const room = rooms[roomCode];
        if (!room) return;

        room.answers[socket.id] = data;

        // 两人都交卷后开始裁判
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

            // 🌟 新增：计分逻辑 (谁赢谁加1分)
            let isGameOver = false;
            if (winner && winner !== 'none' && winner !== 'tie') {
                room.scores[winner]++;
                // 判断是否有人率先达到 8 分
                if (room.scores[winner] >= 8) {
                    isGameOver = true;
                }
            }

            // 广播结果，带上最新比分和是否结束的标志
            io.to(roomCode).emit('roundResult', {
                winner: winner,
                scores: room.scores,
                isGameOver: isGameOver,
                results: { [p1]: ans1, [p2]: ans2 }
            });

            room.answers = {}; // 清空本轮答卷
            
            // 如果游戏结束，清理房间
            if (isGameOver) {
                delete rooms[roomCode];
            }
        }
    });

    // 下一回合请求（需要两人都点下一回合才开始，这里简化为谁点谁触发）
    socket.on('nextRound', (roomCode) => {
        io.to(roomCode).emit('nextRoundStart');
    });

    // 🌟 新增：玩家掉线处理
    socket.on('disconnect', () => {
        console.log('玩家断开连接:', socket.id);
        // 查找该玩家所在的房间，通知另一名玩家
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.players.includes(socket.id)) {
                io.to(roomCode).emit('opponentLeft');
                delete rooms[roomCode]; // 销毁废弃房间
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});