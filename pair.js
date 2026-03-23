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

        // 💾 Save credentials
        sock.ev.on("creds.update", saveCreds);

        // 🔥 CONNECTION EVENT
        sock.ev.on("connection.update", async (update) => {
            console.log("UPDATE:", update); // debug

            const { connection } = update;

            if (connection === "open") {
                console.log("✅ Connected to WhatsApp");

                // ⏳ wait for user object
                let tries = 0;
                while (!sock.user && tries < 10) {
                    await delay(1000);
                    tries++;
                }

                if (!sock.user) {
                    console.log("❌ sock.user not ready");
                    return;
                }

                await delay(5000);

                try {
                    const data = fs.readFileSync(`${sessionPath}/creds.json`);
                    const b64data = Buffer.from(data).toString('base64');

                    const sent = await sock.sendMessage(sock.user.id, {
                        text: b64data
                    });

                    const msg = `
✅ *SESSION GENERATED SUCCESSFULLY*

📦 Your session:
${b64data.slice(0, 25)}...

🔗 Join Channel:
https://whatsapp.com/channel/0029VaeRrcnADTOKzivM0S1r
`;

                    await sock.sendMessage(sock.user.id, {
                        text: msg
                    }, { quoted: sent });

                    console.log("✅ Session sent to WhatsApp");

                } catch (err) {
                    console.log("❌ SEND ERROR:", err);
                }

                // 🧹 Cleanup
                setTimeout(() => {
                    removeFile(sessionPath);
                }, 60000);
            }
        });

        // ⏳ Give socket time to initialize
        await delay(2000);

        let code;
        try {
            code = await sock.requestPairingCode(num);
        } catch (err) {
            console.log("❌ PAIR CODE ERROR:", err);
            return res.json({ status: false, error: "Failed to generate pairing code" });
        }

        // ✅ Send code to frontend
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
