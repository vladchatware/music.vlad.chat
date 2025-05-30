const express = require('express')
const fs = require('fs');
const path = require('path');
const https = require('https')
const app = express()

app.use((_, res, next) => {
    res.set({
        // "Cross-Origin-Opener-Policy": "same-origin",
        // "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "cross-origin",
        // "Origin-Agent-Cluster": "?1",
        "Access-Control-Allow-Origin": "*",
        // "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        // "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Range"
    })
    next()
})

app.use(express.static('public'))

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html')
})

const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.cert'))
};

app.listen(3000, () => {
  console.log('Server running on port 3000')
})
// https.createServer(sslOptions, app).listen(3000, () => {
//   console.log('Server running on port 3000')
// })

