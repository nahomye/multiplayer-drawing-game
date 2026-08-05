const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); // <-- NEU: Path-Modul geladen

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// NEU: Absoluter Pfad für den public-Ordner (Kugelsicher für Render)
app.use(express.static(path.join(__dirname, 'public')));

const words = ["Elefant", "Eiffelturm", "Fahrrad", "Schneemann", "Pizza", "Hubschrauber", "Gitarre", "Kaffeetasse", "Pyramide", "Pinguin"];

// Das wichtigste Neue: Wir speichern die Spieldaten jetzt PRO RAUM, nicht mehr global.
const rooms = {};

// Generiert einen zufälligen 4-stelligen Raumcode
function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms[code]); // Sicherstellen, dass der Code nicht schon existiert
    return code;
}

io.on('connection', (socket) => {
    
    // 1. Host erstellt einen Raum
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
            gameStarted: false
        };
        // Der Host betritt den "Socket-Raum"
        socket.join(roomCode);
        socket.emit('room-created', roomCode);
    });

    // 2. Spieler betritt einen bestimmten Raum mit Code
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
        socket.join(roomCode); // Spieler betritt den Socket-Raum
        
        // Nur die Spieler in diesem bestimmten Raum updaten
        io.to(roomCode).emit('update-players', room.players);
        socket.emit('joined-success', roomCode);
    });

    // 3. Host startet das Spiel für seinen Raum
    socket.on('start-game', (roomCode) => {
        const room = rooms[roomCode];
        // Sicherheit: Nur der echte Host dieses Raums darf starten
        if (!room || room.hostSocketId !== socket.id) return;

        if (room.players.length < 3) {
            socket.emit('error-msg', 'Mindestens 3 Spieler erforderlich!');
            return;
        }

        room.gameStarted = true;
        room.drawingHistory = [];
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

    // 4. Zeichnen - jetzt raumspezifisch
    socket.on('draw-stroke', (data) => {
        const roomCode = data.roomCode;
        const room = rooms[roomCode];
        if(room) {
            room.drawingHistory.push(data.stroke);
            io.to(roomCode).emit('draw-stroke-all', data.stroke); // Nur an diesen Raum senden
        }
    });

    // 5. Zug beenden
    socket.on('finish-turn', (roomCode) => {
        const room = rooms[roomCode];
        if(!room) return;

        room.currentTurnIndex++;
        if (room.currentTurnIndex >= room.players.length) {
            room.currentTurnIndex = 0;
            room.currentRound++;
        }

        if (room.currentRound > room.maxRounds) {
            const spyName = room.players.find(p => p.id === room.spySocketId)?.name || "Unbekannt";
            io.to(roomCode).emit('game-over', { word: room.secretWord, spyName: spyName });
            room.gameStarted = false;
        } else {
            const nextPlayer = room.players[room.currentTurnIndex];
            io.to(roomCode).emit('next-turn', { currentPlayer: nextPlayer.name });
            io.to(nextPlayer.id).emit('your-turn', room.drawingHistory);
        }
    });

    // 6. Spieler verlässt Spiel
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

// NEU: Dynamischer Port von Render
const PORT = process.env.PORT || 3000; 

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server läuft auf Port ${PORT}`);
});