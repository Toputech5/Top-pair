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

        // 🔥 CONNECTION EVENT (IMPORTANT PART)
        sock.ev.on("connection.update", async (update) => {
            const { connection } = update;

            if (connection === "open") {
                console.log("✅ WhatsApp Connected");

                await delay(5000);

                try {
                    const data = fs.readFileSync(`${sessionPath}/creds.json`);
                    const b64data = Buffer.from(data).toString('base64');

                    const msg = await sock.sendMessage(sock.user.id, {
                        text: b64data
                    });

                    let FLASH_MD_TEXT = `
THANK YOU FOR CHOOSING ALONE MD
🔙💚☯️ DRIP FAMILY 🤼 💫

╭━━━━❤━━━━╮
💥 VERY ACTIVE 🙅
🕊️ Clean always 🍏
╰━━━━🥺━━━━╯💚🔙

❒ WhatsApp Channel:
https://whatsapp.com/channel/0029VaeRrcnADTOKzivM0S1r

Follow our channel to learn how to deploy.
Repository available at our channel.
`;

                    await sock.sendMessage(sock.user.id, {
                        text: FLASH_MD_TEXT
                    }, { quoted: msg });

                } catch (err) {
                    console.log("SESSION ERROR:", err);
                }

                // 🧹 Cleanup after success
                setTimeout(() => {
                    removeFile(sessionPath);
                }, 60000);
            }
        });

        // 🔥 Wait before requesting pairing code
        await delay(2000);

        let code;
        try {
            code = await sock.requestPairingCode(num);
        } catch (err) {
            console.log("PAIR CODE ERROR:", err);
            return res.json({ status: false, error: "Failed to generate pairing code" });
        }

        // ✅ SEND CODE TO FRONTEND
        res.json({
            status: true,
            code: code
        });

    } catch (err) {
        console.log("MAIN ERROR:", err);

        res.json({
            status: false,
            error: "Server error"
        });
    }
});

module.exports = router;
