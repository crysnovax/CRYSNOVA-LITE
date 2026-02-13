const express = require('express');
const http = require('http');
const { kordAi } = require('./src/Utils/Kord');
const path = require('path');
const { kordStatistic } = require('./src/Plugin/kordStatistic');
const { checkFFmpeg } = require('./src/Plugin/kordModule');
const socketIo = require('socket.io');

// ── NEW IMPORTS for pairing code mode ────────────────────────────────
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

// Serve static files from the 'Public' folder
app.use(express.static(path.join(__dirname, 'Public')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/Public/index.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Improved global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  const errorMessage = err.message || 'Internal Server Error';
  res.status(statusCode).send(errorMessage);
});

// ── MAIN START FUNCTION ──────────────────────────────────────────────
(async () => {
  try {
    // Kord statistics & ffmpeg check (keep original)
    kordStatistic(app, io);
    checkFFmpeg((isInstalled) => {
      if (!isInstalled) {
        // Your original disk check + download logic
        checkDiskSpace((hasSpace) => {
          if (hasSpace) {
            downloadFFmpeg();
          }
        });
      }
    });

    server.listen(port, async () => {
      console.log(`Server is listening on port ${port}`);

      // ── OUR STYLE: Pairing code mode if no session ──────────────────
      const sessionPath = path.join(__dirname, 'session'); // adjust if Kord uses different folder name

      const hasSession = fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0;

      if (hasSession) {
        console.log('Existing session found → normal connection');
        await kordAi(io, app);
      } else {
        console.log('No session found → starting PHONE NUMBER + PAIRING CODE mode');

        // Ask for phone number in terminal/logs
        const phoneNumber = await new Promise(resolve => {
          rl.question('\nEnter WhatsApp number (with country code, no + or 0, e.g. 2348012345678): ', resolve);
        });

        const cleanNumber = phoneNumber.trim().replace(/\D/g, '');

        if (!cleanNumber || cleanNumber.length < 10) {
          console.error('Invalid phone number');
          process.exit(1);
        }

        console.log(`\nRequesting pairing code for +${cleanNumber}...`);

        try {
          const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
          const tempSock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Chrome (Linux)', 'Chrome', 'Chrome']
          });

          const code = await tempSock.requestPairingCode(cleanNumber);
          console.log(`\n╔════════════════════════════════════╗`);
          console.log(`║   PAIRING CODE: ${code}   ║`);
          console.log(`╚════════════════════════════════════╝`);
          console.log('\nGo to WhatsApp → Settings → Linked Devices → "Link with phone number"');
          console.log('Enter the code above. Bot will connect automatically.\n');

          tempSock.ev.on('connection.update', (update) => {
            const { connection } = update;
            if (connection === 'open') {
              console.log('Successfully paired! Session saved.');
              saveCreds();
              tempSock.end();
              // Now launch the full Kord bot
              kordAi(io, app);
            }
          });

          tempSock.ev.on('creds.update', saveCreds);

        } catch (err) {
          console.error('Pairing failed:', err.message || err);
          process.exit(1);
        }
      }
    });

  } catch (err) {
    console.error('Fatal startup error:', err);
  }
})();
