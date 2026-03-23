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

        sock.ev.on("creds.update", async () => {
            saveCreds();

            // 🔥 Wait for creds.json to exist
            const filePath = `${sessionPath}/creds.json`;

            let tries = 0;
            while (!fs.existsSync(filePath) && tries < 10) {
                await delay(1000);
                tries++;
            }

            if (!fs.existsSync(filePath)) {
                console.log("❌ creds.json not found");
                return;
            }

            // 🔥 Wait more for full login
            await delay(6000);

            try {
                const data = fs.readFileSync(filePath);
                const b64data = Buffer.from(data).toString('base64');

                // 🔥 Ensure user is ready
                if (!sock.user) {
                    console.log("❌ sock.user not ready");
                    return;
                }

                const sent = await sock.sendMessage(sock.user.id, {
                    text: b64data
                });

                await sock.sendMessage(sock.user.id, {
                    text: `✅ SESSION GENERATED\n\n${b64data.slice(0, 30)}...\n\nJoin:\nhttps://whatsapp.com/channel/0029VaeRrcnADTOKzivM0S1r`
                }, { quoted: sent });

                console.log("✅ Session sent successfully");

            } catch (err) {
                console.log("❌ SEND ERROR:", err);
            }

            // 🧹 cleanup
            setTimeout(() => {
                removeFile(sessionPath);
            }, 60000);
        });

        // ⏳ wait before requesting code
        await delay(2000);

        const code = await sock.requestPairingCode(num);

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
