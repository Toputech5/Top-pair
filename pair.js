const express = require('express');
const router = express.Router();
const fs = require('fs');
const pino = require("pino");

const { makeid } = require('./id');

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

    // Normalize number
    num = num.replace(/[^0-9]/g, '');

    const sessionPath = './temp/' + id;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

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

        // 🔥 CONNECTION DEBUG
        sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
            console.log("📡 Connection:", connection);

            if (connection === "open") {
                console.log("✅ WhatsApp Connected Successfully");
            }

            if (connection === "close") {
                console.log("❌ Disconnected:", lastDisconnect?.error);
            }
        });

        // 💾 Save creds
        sock.ev.on("creds.update", saveCreds);

        // 🔥 USE OLD WORKING LOGIC (IMPORTANT FIX)
        if (!sock.authState.creds.registered) {
            await delay(2000);

            const code = await sock.requestPairingCode(num);

            console.log("📌 Pairing Code:", code);

            if (!res.headersSent) {
                res.json({
                    status: true,
                    code: code
                });
            }
        }

        // 🔄 WAIT FOR CREDS FILE
        const filePath = `${sessionPath}/creds.json`;

        let tries = 0;
        while (!fs.existsSync(filePath) && tries < 25) {
            await delay(1000);
            tries++;
        }

        if (!fs.existsSync(filePath)) {
            console.log("❌ creds.json not found");
            return;
        }

        // ⏳ Extra delay (VERY IMPORTANT for Business)
        await delay(12000);

        try {
            const data = fs.readFileSync(filePath);
            const b64data = Buffer.from(data).toString('base64');

            const jid = num + '@s.whatsapp.net';

            let sent = false;
            let msg;

            // 🔁 Retry sending session
            for (let i = 0; i < 5; i++) {
                try {
                    msg = await sock.sendMessage(jid, {
                        text: `✅ SESSION GENERATED\n\n${b64data}`
                    });

                    sent = true;
                    break;
                } catch (err) {
                    console.log(`Retry sending session (${i + 1})`);
                    await delay(3000);
                }
            }

            if (!sent) {
                console.log("❌ Failed to send session");
                return;
            }

            // ✨ Styled message
            const text = `
✅ SESSION LINKED SUCCESSFULLY

🔐 Your WhatsApp is now connected.

⚠️ Keep your session safe.
📦 Do NOT share it with anyone.

🔗 Channel:
https://whatsapp.com/channel/0029VaeRrcnADTOKzivM0S1r
`;

            await sock.sendMessage(jid, {
                text: text
            }, { quoted: msg });

            console.log("✅ Session sent successfully");

        } catch (err) {
            console.log("❌ SEND ERROR:", err);
        }

        // 🧹 Cleanup after 1 min
        setTimeout(() => {
            removeFile(sessionPath);
        }, 60000);

    } catch (err) {
        console.log("❌ MAIN ERROR:", err);

        if (!res.headersSent) {
            res.json({
                status: false,
                error: "Server error"
            });
        }
    }
});

module.exports = router;
