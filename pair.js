const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL');

const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const router = express.Router();
const pino = require("pino");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

// 🧹 Clean temp folder
function removeFile(path) {
    if (fs.existsSync(path)) {
        fs.rmSync(path, { recursive: true, force: true });
    }
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    if (!num) {
        return res.json({ status: false, error: "Number is required" });
    }

    num = num.replace(/[^0-9]/g, '');

    const sessionPath = './temp/' + id;

    async function START_PAIRING() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        try {
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "silent" })
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS("Chrome"),
            });

            // 💾 Save creds
            sock.ev.on('creds.update', saveCreds);

            let codeSent = false;

            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                console.log("📡 Connection:", connection);

                // 🔥 FIX: send pairing at correct time
                if (!sock.authState.creds.registered && !codeSent) {
                    await delay(2000);

                    const code = await sock.requestPairingCode(num);

                    console.log("📌 Pair Code:", code);

                    codeSent = true;

                    if (!res.headersSent) {
                        res.json({ status: true, code });
                    }
                }

                if (connection === "open") {
                    console.log("✅ CONNECTED");

                    await delay(5000);

                    const filePath = `${sessionPath}/creds.json`;

                    if (!fs.existsSync(filePath)) {
                        console.log("❌ creds.json missing");
                        return;
                    }

                    const data = fs.readFileSync(filePath);
                    const b64data = Buffer.from(data).toString('base64');

                    try {
                        // 🔥 send to SELF (this is what your old code did)
                        const msg = await sock.sendMessage(sock.user.id, {
                            text: b64data
                        });

                        const text = `
THANK YOU FOR CHOOSING ALONE MD

🔙💚 DRIP FAMILY 💫
╭━━━━❤━━━━╮
💥 VERY ACTIVE
🕊️ CLEAN ALWAYS
╰━━━━🥺━━━━╯

🔗 Channel:
https://whatsapp.com/channel/0029VaeRrcnADTOKzivM0S1r

⚠️ Save your session safely!
`;

                        await sock.sendMessage(sock.user.id, {
                            text: text
                        }, { quoted: msg });

                        console.log("✅ Session sent");

                    } catch (err) {
                        console.log("❌ Send error:", err);
                    }

                    await delay(500);
                    await sock.ws.close();
                    removeFile(sessionPath);
                }

                // 🔁 Auto-reconnect if needed
                if (
                    connection === "close" &&
                    lastDisconnect?.error?.output?.statusCode !== 401
                ) {
                    console.log("🔄 Reconnecting...");
                    await delay(5000);
                    START_PAIRING();
                }
            });

        } catch (err) {
            console.log("❌ ERROR:", err);

            removeFile(sessionPath);

            if (!res.headersSent) {
                res.json({ status: false, error: "Service Unavailable" });
            }
        }
    }

    START_PAIRING();
});

module.exports = router;
