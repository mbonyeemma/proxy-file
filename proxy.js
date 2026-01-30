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

const MAX_LOG_BODY = 10 * 1024; // 10KB max to log

function safeString(buf) {
  try {
    return buf.length ? buf.toString("utf8") : "";
  } catch {
    return "<binary>";
  }
}

const server = http.createServer((req, res) => {
  const reqPath = req.url || "/";
  // Append request path to base path so /api/ is kept (new URL(path, base) would replace base path)
  const base = new URL(BASE_URL.replace(/\/$/, "") + "/");
  const basePath = base.pathname.replace(/\/$/, "");
  const pathAndSearch = reqPath.startsWith("/") ? reqPath : "/" + reqPath;
  const target = new URL(basePath + pathAndSearch, base.origin);
  const targetUrl = target.href;

  console.log(`[proxy] ${req.method} ${reqPath} → ${targetUrl}`);

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const bodyStr = safeString(body);
    console.log("[proxy] REQUEST headers:", JSON.stringify(req.headers, null, 2));
    if (body.length) {
      const toLog = body.length <= MAX_LOG_BODY ? bodyStr : bodyStr.slice(0, MAX_LOG_BODY) + "\n... (truncated)";
      console.log("[proxy] REQUEST body:", toLog);
    }

    // Forward request headers as-is; only override host for upstream
    const reqHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) reqHeaders[k] = v;
    }
    reqHeaders.host = target.host;

    const opts = {
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers: reqHeaders,
    };

    const client = target.protocol === "https:" ? https : http;
    const proxyReq = client.request(opts, (proxyRes) => {
      const resChunks = [];
      proxyRes.on("data", (chunk) => resChunks.push(chunk));
      proxyRes.on("end", () => {
        const resBody = Buffer.concat(resChunks);
        const resBodyStr = safeString(resBody);
        const status = proxyRes.statusCode;
        console.log(`[proxy] ${req.method} ${reqPath} ← ${status}`);

        // Forward response headers as-is
        const resHeaders = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (v !== undefined) resHeaders[k] = v;
        }

        const toLog = resBody.length <= MAX_LOG_BODY ? resBodyStr : resBodyStr.slice(0, MAX_LOG_BODY) + "\n... (truncated)";
        if (status >= 400) {
          console.error("[proxy] UPSTREAM ERROR " + status + " body: " + (toLog || "(empty)"));
          console.error("[proxy] UPSTREAM ERROR " + status + " headers: " + JSON.stringify(resHeaders));
        } else {
          console.log("[proxy] RESPONSE body:", toLog || "(empty)");
        }

        res.writeHead(status, resHeaders);
        res.end(resBody);
      });
    });

    proxyReq.on("error", (err) => {
      console.error(`[proxy] ${req.method} ${reqPath} ✗ ${err.message}`);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway: " + err.message);
    });

    proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, () => console.log(`Proxy → ${BASE_URL} listening on :${PORT}`));
