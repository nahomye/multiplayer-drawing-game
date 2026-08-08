const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const words = ["Elefant", "Eiffelturm", "Fahrrad", "Schneemann", "Pizza", "Hubschrauber", "Gitarre", "Kaffeetasse", "Pyramide", "Pinguin"];
const rooms = {};

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    
    socket.on('create-room', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostSocketId: socket.id,
            players: [],
            drawingHistory: [],
            secretWord: "",
            spySocketId: null,
            currentTurnIndex: 0,
            currentRound: 1,
            maxRounds: 2,
            gameStarted: false,
            votes: {} // NEU: Speicher für die Abstimmung
        };
        socket.join(roomCode);
        socket.emit('room-created', roomCode);
    });

    socket.on('join-room', (data) => {
        const roomCode = data.roomCode.toUpperCase();
        const room = rooms[roomCode];

        if (!room) {
            socket.emit('error-msg', 'Raum nicht gefunden! Bitte Code prüfen.');
            return;
        }
        if (room.gameStarted) {
            socket.emit('error-msg', 'Das Spiel in diesem Raum läuft bereits!');
            return;
        }

        room.players.push({ id: socket.id, name: data.name });
        socket.join(roomCode);
        
        io.to(roomCode).emit('update-players', room.players);
        socket.emit('joined-success', roomCode);
    });

    socket.on('start-game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostSocketId !== socket.id) return;

        if (room.players.length < 3) {
            socket.emit('error-msg', 'Mindestens 3 Spieler erforderlich!');
            return;
        }

        room.gameStarted = true;
        room.drawingHistory = [];
        room.votes = {}; // Stimmen zum Start zurücksetzen
        io.to(roomCode).emit('clear-canvas');

        room.secretWord = words[Math.floor(Math.random() * words.length)];
        const spyIndex = Math.floor(Math.random() * room.players.length);
        room.spySocketId = room.players[spyIndex].id;
        room.currentTurnIndex = 0;
        room.currentRound = 1;

        room.players.forEach(p => {
            if (p.id === room.spySocketId) {
                io.to(p.id).emit('role-info', { isSpy: true });
            } else {
                io.to(p.id).emit('role-info', { isSpy: false, word: room.secretWord });
            }
        });

        io.to(roomCode).emit('game-started', { currentPlayer: room.players[room.currentTurnIndex].name });
        io.to(room.players[room.currentTurnIndex].id).emit('your-turn', room.drawingHistory);
    });

    socket.on('draw-stroke', (data) => {
        const room = rooms[data.roomCode];
        if(room) {
            room.drawingHistory.push(data.stroke);
            io.to(data.roomCode).emit('draw-stroke-all', data.stroke); 
        }
    });

    socket.on('finish-turn', (roomCode) => {
        const room = rooms[roomCode];
        if(!room) return;

        room.currentTurnIndex++;
        if (room.currentTurnIndex >= room.players.length) {
            room.currentTurnIndex = 0;
            room.currentRound++;
        }

        if (room.currentRound > room.maxRounds) {
            // NEU: Voting-Phase einleiten
            room.votes = {}; 
            io.to(roomCode).emit('start-voting', room.players);
        } else {
            const nextPlayer = room.players[room.currentTurnIndex];
            io.to(roomCode).emit('next-turn', { currentPlayer: nextPlayer.name });
            io.to(nextPlayer.id).emit('your-turn', room.drawingHistory);
        }
    });

    // NEU: Abstimmungseingänge verarbeiten
    socket.on('submit-vote', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        room.votes[socket.id] = data.votedForId;

        // Sobald alle Spieler im Raum abgestimmt haben
        if (Object.keys(room.votes).length === room.players.length) {
            const spyName = room.players.find(p => p.id === room.spySocketId)?.name || "Unbekannt";
            
            io.to(data.roomCode).emit('game-over', { 
                word: room.secretWord, 
                spyName: spyName 
            });
            room.gameStarted = false;
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const initialLength = room.players.length;
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length !== initialLength) {
                io.to(roomCode).emit('update-players', room.players);
            }
        }
    });
});

const PORT = process.env.PORT || 3000; 
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server läuft auf Port ${PORT}`);
});