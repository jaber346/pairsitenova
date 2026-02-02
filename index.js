import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

import qrRouter from './qr.js';
import pairRouter from './pair.js';

const app = express();

// CORS (important pour que d'autres domaines puissent appeler Render)
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

// Éviter limite d’événements
import('events').then((events) => {
  events.EventEmitter.defaultMaxListeners = 500;
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get('/health', (req, res) => res.status(200).json({ ok: true }));

// Routes API
app.use('/qr', qrRouter);
app.use('/code', pairRouter);

// Pages HTML
app.get('/pair', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')));
app.get('/qrpage', (req, res) => res.sendFile(path.join(__dirname, 'qr.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'main.html')));

// IMPORTANT: écouter sur 0.0.0.0 pour Render/Katabump
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
