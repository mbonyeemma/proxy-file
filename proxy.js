/**
 * Simple pass-through proxy. Forwards GET/POST (and other methods) to BASE_URL + path.
 * No processing — request in, response out.
 */
const fs = require("fs");
const path = require("path");
try {
  const env = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(env)) {
    fs.readFileSync(env, "utf8").split("\n").forEach((line) => {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    });
  }
} catch (_) {}
const http = require("http");

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  console.error("Missing BASE_URL in .env");
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 8080;

const https = require("https");

const server = http.createServer((req, res) => {
  const reqPath = req.url || "/";
  const target = new URL(reqPath, BASE_URL.replace(/\/$/, "") + "/");
  const targetUrl = target.href;

  console.log(`[proxy] ${req.method} ${reqPath} → ${targetUrl}`);

  const opts = {
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: target.pathname + target.search,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  };

  const client = target.protocol === "https:" ? https : http;
  const proxyReq = client.request(opts, (proxyRes) => {
    console.log(`[proxy] ${req.method} ${reqPath} ← ${proxyRes.statusCode}`);
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`[proxy] ${req.method} ${reqPath} ✗ ${err.message}`);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway: " + err.message);
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => console.log(`Proxy → ${BASE_URL} listening on :${PORT}`));
