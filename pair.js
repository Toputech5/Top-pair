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

// 🧹 cleanup
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
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: "silent" })
                ),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.macOS("Chrome"),
        });

        sock.ev.on("creds.update", saveCreds);

        let codeSent = false;

        // 🔥 MAIN CONNECTION HANDLER
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            console.log("📡", connection);

            // ✅ SEND PAIRING CODE AT RIGHT TIME
            if (connection === "connecting" && !sock.authState.creds.registered && !codeSent) {
                await delay(3000);

                const code = await sock.requestPairingCode(num);

                console.log("📌 CODE:", code);

                codeSent = true;

                if (!res.headersSent) {
                    res.json({
                        status: true,
                        code: code,
                        instructions: "Open WhatsApp → Linked Devices → Link with phone number → Enter this code"
                    });
                }
            }

            // ✅ AFTER SUCCESSFUL LINK
            if (connection === "open") {
                console.log("✅ CONNECTED");

                await delay(5000);

                const filePath = `${sessionPath}/creds.json`;

                if (!fs.existsSync(filePath)) {
                    console.log("❌ creds.json not found");
                    return;
                }

                const data = fs.readFileSync(filePath);
                const session = Buffer.from(data).toString("base64");

                try {
                    await sock.sendMessage(sock.user.id, {
                        text: `✅ SESSION ID:\n\n${session}`
                    });

                    console.log("✅ Session sent to WhatsApp");

                } catch (err) {
                    console.log("❌ Failed to send session");
                }

                // cleanup
                setTimeout(() => removeFile(sessionPath), 60000);
            }

            // 🔁 reconnect if needed
            if (
                connection === "close" &&
                lastDisconnect?.error?.output?.statusCode !== 401
            ) {
                console.log("🔄 Reconnecting...");
                await delay(5000);
            }
        });

    } catch (err) {
        console.log("❌ ERROR:", err);

        if (!res.headersSent) {
            res.json({
                status: false,
                error: "Server error"
            });
        }
    }
});

module.exports = router;
