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
    const num = req.query.number;

    if (!num) {
        return res.json({ status: false, error: "Number is required" });
    }

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

        // 💾 Save creds
        sock.ev.on("creds.update", async () => {
            await saveCreds();

            const filePath = `${sessionPath}/creds.json`;

            // ⏳ wait until creds.json exists
            let tries = 0;
            while (!fs.existsSync(filePath) && tries < 10) {
                await delay(1000);
                tries++;
            }

            if (!fs.existsSync(filePath)) {
                console.log("❌ creds.json not found");
                return;
            }

            // ⏳ IMPORTANT: longer delay for WhatsApp Business
            await delay(15000);

            try {
                const data = fs.readFileSync(filePath);
                const b64data = Buffer.from(data).toString('base64');

                // 🔒 Ensure user exists
                if (!sock.user || !sock.user.id) {
                    console.log("❌ sock.user not ready");
                    return;
                }

                // 🔁 Retry sending (fix Business issue)
                let sent = false;
                let msg;

                for (let i = 0; i < 5; i++) {
                    try {
                        msg = await sock.sendMessage(sock.user.id, {
                            text: b64data
                        });
                        sent = true;
                        break;
                    } catch (err) {
                        console.log("Retry sending...", i + 1);
                        await delay(3000);
                    }
                }

                if (!sent) {
                    console.log("❌ Failed to send session");
                    return;
                }

                // ✨ Stylish message
                const text = `
✅ SESSION GENERATED SUCCESSFULLY

📦 Your session:
${b64data.slice(0, 30)}...

🔗 Channel:
https://whatsapp.com/channel/0029VaeRrcnADTOKzivM0S1r

⚠️ Save this session safely!
`;

                await sock.sendMessage(sock.user.id, {
                    text: text
                }, { quoted: msg });

                console.log("✅ Session sent successfully");

            } catch (err) {
                console.log("❌ SEND ERROR:", err);
            }

            // 🧹 cleanup
            setTimeout(() => {
                removeFile(sessionPath);
            }, 60000);
        });

        // ⏳ wait before pairing request
        await delay(2000);

        const code = await sock.requestPairingCode(num);

        // ✅ Send pairing code to frontend
        res.json({
            status: true,
            code: code
        });

    } catch (err) {
        console.log("❌ MAIN ERROR:", err);

        res.json({
            status: false,
            error: "Server error"
        });
    }
});

module.exports = router;
