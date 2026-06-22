import * as http from "http";
import { JsonLogger } from "./JsonLogger";

export class AuthProxy {
  private server: http.Server | null = null;
  private port = 0;
  private authHeader = "";

  async start(targetUrl: string, username: string, password: string): Promise<string> {
    if (this.server) return this.proxyUrl();
    this.authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
    let target: URL;
    try {
      target = new URL(targetUrl);
    } catch {
      throw new Error(`AuthProxy: invalid target URL: ${targetUrl}`);
    }
    const targetHost = target.hostname;
    const targetPort = Number(target.port) || (target.protocol === "https:" ? 443 : 80);

    return new Promise((resolve, reject) => {
      const server = http.createServer();
      this.server = server;

      server.on("request", (req, res) => {
        const opts: http.RequestOptions = {
          hostname: targetHost,
          port: targetPort,
          path: req.url,
          method: req.method,
          headers: this.buildHeaders(req.headers, targetHost, targetPort),
        };
        const proxyReq = http.request(opts, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on("error", (e) => {
          JsonLogger.log("error", { source: "AuthProxy", error: e.message, phase: "request" });
          if (!res.headersSent) res.statusCode = 502;
          res.end(String(e));
        });
        req.pipe(proxyReq);
      });

      server.on("upgrade", (req, socket, head) => {
        const opts: http.RequestOptions = {
          hostname: targetHost,
          port: targetPort,
          path: req.url,
          method: "GET",
          headers: this.buildHeaders(req.headers, targetHost, targetPort),
        };
        const proxyReq = http.request(opts);
        proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
          const statusLine = `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
          socket.write(statusLine);
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (v === undefined) continue;
            const arr = Array.isArray(v) ? v : [v];
            for (const val of arr) socket.write(`${k}: ${val}\r\n`);
          }
          socket.write("\r\n");
          if (proxyHead && proxyHead.length) socket.write(proxyHead);
          proxySocket.pipe(socket);
          socket.pipe(proxySocket);
        });
        proxyReq.on("error", (e) => {
          JsonLogger.log("error", { source: "AuthProxy", error: e.message, phase: "upgrade" });
          socket.destroy();
        });
        req.pipe(proxyReq);
      });

      server.on("error", (e) => {
        JsonLogger.log("error", { source: "AuthProxy", error: e.message, phase: "listen" });
        reject(e);
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          JsonLogger.log("meta", { event: "AuthProxy-start", port: this.port, target: targetUrl });
          resolve(this.proxyUrl());
        } else {
          reject(new Error("AuthProxy: failed to bind"));
        }
      });
    });
  }

  private buildHeaders(incoming: http.IncomingHttpHeaders, host: string, port: number): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = { ...(incoming as http.OutgoingHttpHeaders) };
    headers["host"] = `${host}:${port}`;
    headers["authorization"] = this.authHeader;
    if (headers["connection"]) {
      const v = headers["connection"];
      if (typeof v === "string" && v.toLowerCase().includes("upgrade")) {
        headers["connection"] = "Upgrade";
      }
    }
    return headers;
  }

  proxyUrl(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  stop(): void {
    if (this.server) {
      JsonLogger.log("meta", { event: "AuthProxy-stop", port: this.port });
      try { this.server.close(); } catch { /* ignore */ }
      this.server = null;
      this.port = 0;
      this.authHeader = "";
    }
  }

  isRunning(): boolean {
    return this.server !== null;
  }
}
