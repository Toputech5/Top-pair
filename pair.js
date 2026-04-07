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

// cleanup
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

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.macOS("Chrome"),
        });

        sock.ev.on("creds.update", saveCreds);

        // 🔥 CONNECTION HANDLER
        sock.ev.on("connection.update", async ({ connection }) => {
            if (connection === "open") {
                console.log("✅ CONNECTED");

                // wait a bit
                await delay(5000);

                const filePath = `${sessionPath}/creds.json`;

                if (fs.existsSync(filePath)) {
                    const data = fs.readFileSync(filePath);
                    const session = Buffer.from(data).toString("base64");

                    const jid = num + "@s.whatsapp.net";

                    try {
                        await sock.sendMessage(jid, {
                            text: `✅ SESSION ID:\n\n${session}`
                        });

                        console.log("✅ Session sent");
                    } catch (err) {
                        console.log("❌ Failed to send session");
                    }
                }

                // cleanup
                setTimeout(() => removeFile(sessionPath), 60000);
            }
        });

        // 🔥 ONLY REQUEST CODE IF NOT REGISTERED
        if (!sock.authState.creds.registered) {
            await delay(2000);

            const code = await sock.requestPairingCode(num);

            console.log("PAIR CODE:", code);

            return res.json({
                status: true,
                code: code
            });
        }

    } catch (err) {
        console.log("❌ ERROR:", err);

        return res.json({
            status: false,
            error: "Server error"
        });
    }
});

module.exports = router;
