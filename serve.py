#!/usr/bin/env python3
"""AeroSim X dev server: 禁用缓存 + /diag 诊断日志 + /health + 正确 MIME。"""
import http.server
import socketserver
import urllib.parse
import time
import os
import sys

PORT = int(os.environ.get("PORT", "8000"))
ROOT = os.path.dirname(os.path.abspath(__file__))
DIAG_FILE = "/tmp/aerosim-diag.log"
os.chdir(ROOT)


def out(line):
    """打印到控制台并追加到诊断文件，便于远程读取。"""
    print(line, flush=True)
    try:
        with open(DIAG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
    }

    def _diag(self, method):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/diag":
            if method == "POST":
                n = int(self.headers.get("Content-Length", 0) or 0)
                body = self.rfile.read(n).decode("utf-8", "replace") if n else ""
            else:
                body = urllib.parse.parse_qs(parsed.query).get("m", [""])[0]
            out(f"[diag] {time.strftime('%H:%M:%S')} {body}")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b"ok")
            return True
        if parsed.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b"ok")
            return True
        return False

    def do_GET(self):
        if not self._diag("GET"):
            super().do_GET()

    def do_POST(self):
        if not self._diag("POST"):
            self.send_error(501, "POST not supported")

    def end_headers(self):
        # 页面/脚本一律不缓存，避免陈旧版本
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        line = "%s - %s" % (time.strftime("%H:%M:%S"), fmt % args)
        sys.stderr.write(line + "\n")
        sys.stderr.flush()
        try:
            with open(DIAG_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print(f"AeroSim X → http://localhost:{PORT}", flush=True)
    try:
        Server(("", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
