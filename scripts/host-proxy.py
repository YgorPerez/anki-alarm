"""Reverse proxy that forwards to a local server as if the request came from
127.0.0.1, rewriting Host and Origin. Lets a Cloudflare Quick Tunnel reach
servers that only accept local requests (such as Impeccable's decision page).

    python3 -I scripts/host-proxy.py <listen-port> <target-port>
"""

import http.client
import http.server
import sys

LISTEN, TARGET = int(sys.argv[1]), int(sys.argv[2])
LOCAL = f"127.0.0.1:{TARGET}"
HOP = {"connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"}


class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def forward(self):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        headers["Host"] = LOCAL
        if "Origin" in headers:
            headers["Origin"] = f"http://{LOCAL}"
        if "Referer" in headers:
            headers["Referer"] = f"http://{LOCAL}/"
        conn = http.client.HTTPConnection("127.0.0.1", TARGET, timeout=600)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            res = conn.getresponse()
            data = res.read()
        except OSError as err:
            self.send_error(502, str(err))
            return
        finally:
            conn.close()
        self.send_response(res.status, res.reason)
        for k, v in res.getheaders():
            if k.lower() not in HOP and k.lower() != "content-length":
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = do_OPTIONS = forward

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", LISTEN), Proxy).serve_forever()
