import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import { exec } from 'child_process';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
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
    if (fs.existsSync(dir)) await fs.remove(dir);
}

function randomMegaId(len = 6, numLen = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    const number = Math.floor(Math.random() * Math.pow(10, numLen));
    return `${out}${number}`;
}

/* ================= ROUTE ================= */

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ code: 'Missing number' });

    await removeDir(AUTH_DIR);

    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);

    if (!phone.isValid()) {
        return res.status(400).send({
            code: 'Invalid phone number. Use international format without +'
        });
    }

    num = phone.getNumber('e164').replace('+', '');

    async function runSession() {
        let sessionSent = false;
        let credsStable = false;

        try {
            const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: 'fatal' })
                    )
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false
            });

            // ---- CREDS UPDATE (STABILISATION)
            sock.ev.on('creds.update', async () => {
                await saveCreds();
                credsStable = true;
            });

            // ---- CONNECTION HANDLER
            sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {

                if (connection === 'open' && !sessionSent) {
                    try {
                        // attendre la stabilisation réelle des creds
                        let waited = 0;
                        while (!credsStable && waited < 10000) {
                            await delay(500);
                            waited += 500;
                        }

                        if (!credsStable) {
                            throw new Error('Creds not stabilized');
                        }

                        const credsFile = `${AUTH_DIR}/creds.json`;
                        if (!fs.existsSync(credsFile)) {
                            throw new Error('creds.json missing');
                        }

                        sessionSent = true;

                        const id = randomMegaId();
                        const megaLink = await megaUpload(
                            fs.createReadStream(credsFile),
                            `${id}.json`
                        );

                        const match = megaLink.match(/mega\.nz\/file\/([^#]+)#(.+)/);
                        if (!match) throw new Error('Invalid Mega link');

                        const sessionId = `kaya~${match[1]}#${match[2]}`;
                        const userJid = num + '@s.whatsapp.net';

                        const m1 = await sock.sendMessage(userJid, { text: sessionId });
                        await sock.sendMessage(userJid, { text: MESSAGE, quoted: m1 });

                        await delay(4000);
                        await removeDir(AUTH_DIR);

                    } catch (err) {
                        console.error('SESSION ERROR:', err);
                    }
                }

                if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    if (code !== 401 && !sessionSent) {
                        runSession();
                    } else {
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
            exec('pm2 restart qasim');
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await runSession();
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
        exec('pm2 restart qasim');
    }
});

export default router;