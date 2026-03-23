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

    // Normalize number (remove +, spaces, etc.)
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

        // Handle connection updates
        sock.ev.on("connection.update", ({ connection }) => {
            if (connection === "open") {
                console.log("✅ WhatsApp Connected");
            }
        });

        // Save credentials
        sock.ev.on("creds.update", saveCreds);

        // Wait for connection to stabilize
        await delay(3000);

        // Request pairing code
        const code = await sock.requestPairingCode(num);

        console.log("📌 Pairing Code:", code);

        // Respond immediately with code
        res.json({
            status: true,
            code: code
        });

        // Wait for creds.json to be created
        const filePath = `${sessionPath}/creds.json`;

        let tries = 0;
        while (!fs.existsSync(filePath) && tries < 20) {
            await delay(1000);
            tries++;
        }

        if (!fs.existsSync(filePath)) {
            console.log("❌ creds.json not found");
            return;
        }

        // Wait extra time for stability (important for Business accounts)
        await delay(10000);

        try {
            const data = fs.readFileSync(filePath);
            const b64data = Buffer.from(data).toString('base64');

            const jid = num + '@s.whatsapp.net';

            let sent = false;
            let msg;

            // Retry sending session
            for (let i = 0; i < 5; i++) {
                try {
                    msg = await sock.sendMessage(jid, {
                        text: `✅ SESSION GENERATED\n\n${b64data}`
                    });

                    sent = true;
                    break;
                } catch (err) {
                    console.log(`Retry sending session... (${i + 1})`);
                    await delay(3000);
                }
            }

            if (!sent) {
                console.log("❌ Failed to send session to user");
                return;
            }

            // Optional styled message
            const text = `
✅ SESSION LINKED SUCCESSFULLY

🔐 Your session has been generated.

⚠️ Keep it private and secure.
📦 Do not share with anyone.

🔗 Channel:
https://whatsapp.com/channel/0029VaeRrcnADTOKzivM0S1r
`;

            await sock.sendMessage(jid, {
                text: text
            }, { quoted: msg });

            console.log("✅ Session sent to user");

        } catch (err) {
            console.log("❌ SEND ERROR:", err);
        }

        // Cleanup after 1 minute
        setTimeout(() => {
            removeFile(sessionPath);
        }, 60000);

    } catch (err) {
        console.log("❌ MAIN ERROR:", err);

        res.json({
            status: false,
            error: "Server error"
        });
    }
});

module.exports = router;
