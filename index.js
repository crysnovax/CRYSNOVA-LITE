const express = require('express');
const http = require('http');
const { kordAi } = require('./src/Utils/Kord');
const path = require('path');
const { kordStatistic } = require('./src/Plugin/kordStatistic');
const { checkFFmpeg } = require('./src/Plugin/kordModule');
const socketIo = require('socket.io');

// ── Pairing code imports ─────────────────────────────────────────────
const readline = require('readline');
const fs = require('fs');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// ──────────────────────────────────────────────────────────────────────

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'Public')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/Public/index.html'));
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  const errorMessage = err.message || 'Internal Server Error';
  res.status(statusCode).send(errorMessage);
});

// ── START SERVER + OUR PAIRING LOGIC ─────────────────────────────────
(async () => {
  try {
    kordStatistic(app, io);

    // Check ffmpeg (keep original)
    checkFFmpeg((isInstalled) => {
      if (!isInstalled) {
        checkDiskSpace((hasSpace) => {
          if (hasSpace) {
            downloadFFmpeg();
          }
        });
      }
    });

    server.listen(port, async () => {
      console.log(`Server listening on port ${port}`);

      // ── Pairing code if no session ──────────────────────────────────
      const sessionPath = path.join(__dirname, 'session'); // change if Kord uses different folder

      const hasSession = fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0;

      if (hasSession) {
        console.log('Session exists → normal start');
        await kordAi(io, app);
      } else {
        console.log('No session → pairing mode');

        const phoneNumber = await new Promise(resolve => {
          rl.question('Enter WhatsApp number (country code, no +, e.g. 2348012345678): ', resolve);
        });

        const cleanNumber = phoneNumber.trim().replace(/\D/g, '');

        if (!cleanNumber || cleanNumber.length < 10) {
          console.error('Invalid number');
          process.exit(1);
        }

        console.log(`\nGenerating pairing code for +${cleanNumber}...`);

        try {
          const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
          const tempSock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Chrome (Linux)', 'Chrome', 'Chrome']
          });

          const code = await tempSock.requestPairingCode(cleanNumber);
          console.log(`\n╔══════════════════════════════╗`);
          console.log(`║   PAIRING CODE: ${code}   ║`);
          console.log(`╚══════════════════════════════╝`);
          console.log('\nWhatsApp → Settings → Linked Devices → Link with phone number');
          console.log('Enter the code. Bot will connect automatically.\n');

          tempSock.ev.on('connection.update', (update) => {
            if (update.connection === 'open') {
              console.log('Paired! Session saved.');
              saveCreds();
              tempSock.end();
              kordAi(io, app); // Start full bot
            }
          });

          tempSock.ev.on('creds.update', saveCreds);

        } catch (err) {
          console.error('Pairing error:', err.message || err);
          process.exit(1);
        }
      }
    });

  } catch (err) {
    console.error('Startup error:', err);
  }
})();
