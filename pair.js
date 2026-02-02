import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import { exec } from 'child_process';
import {
  makeWASocket,
  useSingleFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  jidNormalizedUser
} from '@whiskeysockets/baileys';
import { upload as megaUpload } from './mega.js';

const router = express.Router();

const MESSAGE = `
╭───────❖ NOVA-XMD ❖────────⬣
│ ✅ SESSION_ID générée avec succès !
│
│ 🚀 Déployez votre bot gratuitement sur Katabump :
│ 🔗 https://dashboard.katabump.com/auth/login#efded4
│
│ 💬 Channel WhatsApp:
│ ⛓️‍💥 https://whatsapp.com/channel/0029VbBrAUYAojYjf3Ndw70d
╰──────────────────────────⬣
`;

const AUTH_DIR = './auth_info_baileys';

/* ================= UTILS ================= */

async function removeDir(dir) {
  try {
    if (dir && (await fs.pathExists(dir))) await fs.remove(dir);
  } catch {}
}

function randomMegaId(len = 6, numLen = 4) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  const number = Math.floor(Math.random() * Math.pow(10, numLen));
  return `${out}${number}`;
}

/* ================= ROUTE ================= */

router.get('/', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).send({ code: 'Missing number' });

  await removeDir(AUTH_DIR);
  await fs.ensureDir(AUTH_DIR);

  num = String(num).replace(/[^0-9]/g, '');
  const phone = pn('+' + num);

  if (!phone.isValid()) {
    await removeDir(AUTH_DIR);
    return res.status(400).send({
      code: 'Invalid phone number. Use international format without +'
    });
  }

  num = phone.getNumber('e164').replace('+', '');

  let sessionSent = false;

  try {
    // ✅ SINGLE FILE => session complète dans auth.json
    const authFile = `${AUTH_DIR}/auth.json`;
    const { state, saveState } = useSingleFileAuthState(authFile);

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
      },
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' }),
      browser: Browsers.windows('Chrome'),
      markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveState);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'open' && !sessionSent) {
        try {
          await delay(800);

          if (!(await fs.pathExists(authFile))) throw new Error('auth.json missing');

          sessionSent = true;

          const id = randomMegaId();
          const megaLink = await megaUpload(fs.createReadStream(authFile), `${id}.json`);

          const match = megaLink.match(/mega\.nz\/file\/([^#]+)#(.+)/);
          if (!match) throw new Error('Invalid Mega link');

          // ✅ NOVA prefix
          const sessionId = `nova~${match[1]}#${match[2]}`;

          const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

          const m1 = await sock.sendMessage(userJid, { text: sessionId });
          await sock.sendMessage(userJid, { text: MESSAGE, quoted: m1 });

          await delay(4000);
          await removeDir(AUTH_DIR);
          try { sock.end(); } catch {}

        } catch (err) {
          console.error('SESSION ERROR:', err);
        }
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        // pas de boucle infinie
        if (code === 401) {
          await removeDir(AUTH_DIR);
        }
      }
    });

    // ---- PAIRING CODE
    if (!sock.authState.creds.registered) {
      await delay(1500);
      try {
        let code = await sock.requestPairingCode(num);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        if (!res.headersSent) res.send({ code });
      } catch (err) {
        console.error('PAIRING ERROR:', err);
        if (!res.headersSent) {
          res.status(503).send({ code: 'Failed to get pairing code' });
        }
      }
    }
  } catch (err) {
    console.error('GLOBAL ERROR:', err);
    await removeDir(AUTH_DIR);

    // garde ton restart si tu l'utilises vraiment en VPS/PM2
    try { exec('pm2 restart qasim'); } catch {}

    if (!res.headersSent) {
      res.status(503).send({ code: 'Service Unavailable' });
    }
  }
});

/* ================= GLOBAL ERRORS ================= */

process.on('uncaughtException', err => {
  const e = String(err);
  const ignore = [
    'conflict',
    'not-authorized',
    'Socket connection timeout',
    'rate-overlimit',
    'Connection Closed',
    'Timed Out',
    'Value not found',
    'Stream Errored',
    'statusCode: 515',
    'statusCode: 503'
  ];
  if (!ignore.some(x => e.includes(x))) {
    console.error('CRASH:', err);
    try { exec('pm2 restart qasim'); } catch {}
  }
});

export default router;
