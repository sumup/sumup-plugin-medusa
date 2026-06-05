"use strict"

// Tiny zero-dependency static server. It serves the storefront HTML and
// exposes /config.json (publishable key + backend URL) which the seed script
// writes to the shared volume.

const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")

const PORT = Number(process.env.PORT) || 8080
const CONFIG_PATH = process.env.SHARED_CONFIG_PATH || "/shared/config.json"
const PUBLIC_DIR = path.join(__dirname, "public")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
}

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0]

  if (url === "/config.json") {
    try {
      const cfg = fs.readFileSync(CONFIG_PATH, "utf8")
      res.writeHead(200, { "content-type": MIME[".json"] })
      res.end(cfg)
    } catch {
      res.writeHead(503, { "content-type": MIME[".json"] })
      res.end(JSON.stringify({ error: "Storefront config not ready yet." }))
    }
    return
  }

  // Serve index.html for "/" and the SumUp return URL ("/return").
  const requested = url === "/" || url === "/return" ? "/index.html" : url
  const filePath = path.join(PUBLIC_DIR, path.normalize(requested))

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403)
    res.end("Forbidden")
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end("Not found")
      return
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
    })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`Storefront listening on http://localhost:${PORT}`)
})
