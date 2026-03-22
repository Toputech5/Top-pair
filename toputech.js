const express = require('express');
const app = express();
const path = require('path');

const PORT = process.env.PORT || 8000;

// SAFE REQUIRE (avoid crash)
let server, code;

try {
  server = require('./qr');
} catch (e) {
  console.log("QR module error:", e.message);
}

try {
  code = require('./pair');
} catch (e) {
  console.log("PAIR module error:", e.message);
}

// ROUTES
if (server) app.use('/qr', server);
if (code) app.use('/code', code);

app.use('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'pair.html'));
});

app.use('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// EXPRESS BUILT-IN PARSER
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.listen(PORT, () => {
  console.log(`\n🚀 Topu Session Server Running on port ${PORT}\n`);
});

module.exports = app;
