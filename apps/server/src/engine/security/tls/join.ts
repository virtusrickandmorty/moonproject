/**
 * "Join this PC" (PLAN C6): the only page served over plain HTTP. A phone or PC opens http://<this PC's address>/,
 * downloads the shop's CA, checks its code against the one the server PC shows (http://localhost/ on the server PC
 * itself, which no one on the network can tamper with), installs it once, then always uses https://<address>/.
 * Every other path redirects to HTTPS. The app itself is never served over plain HTTP (OWN-13).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { caDer, certInfo } from './certs.ts';

export const CA_FILE = '/moonproject-ca.crt';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The host name or IPv4 address the browser used, without the port; null when it is anything unusual. */
export function requestHost(header: string | undefined): string | null {
  const m = /^([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::\d{1,5})?$/i.exec(header ?? '');
  return m ? m[1]!.toLowerCase() : null;
}

function page(caPem: string, httpsUrl: string, onServer: boolean, joinPort: number): string {
  const ca = certInfo(caPem);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Join this PC to Moonproject</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:1.5rem auto;padding:0 1rem;color:#1a1a1a}
code{display:block;font-size:1.05rem;word-break:break-all;background:#f3f3f0;padding:.5rem;border-radius:.4rem}
a.button{display:inline-block;padding:.6rem 1rem;border-radius:.4rem;background:#1f5f8b;color:#fff;text-decoration:none;margin:.3rem 0}
h2{font-size:1.1rem;margin-top:1.5rem}li{margin:.3rem 0}</style></head><body>
<h1>Join this PC to Moonproject</h1>
<p>Do this once on each phone, tablet or PC. It lets the device open Moonproject over a secure connection.</p>
<h2>1. Download the shop's certificate</h2>
<p><a class="button" href="${CA_FILE}">Download the certificate</a></p>
<h2>2. Check the code</h2>
<p>${onServer ? 'This is the server PC. This is the true code; compare it with what each device shows.' : `On the server PC, open <b>http://localhost${joinPort === 80 ? '' : `:${joinPort}`}/</b> and check that it shows the same code. If it does not, stop and tell an owner.`}</p>
<code>${esc(ca.fingerprint256)}</code>
<p>Windows shows a shorter code called the thumbprint:</p><code>${esc(ca.fingerprint1.replace(/:/g, ''))}</code>
<h2>3. Install it</h2>
<ul>
<li><b>Windows PC:</b> open the downloaded file, choose <i>Install Certificate</i>, then <i>Current User</i>, then <i>Place all certificates in the following store</i>, <i>Browse</i>, <i>Trusted Root Certification Authorities</i>. Finish and answer <i>Yes</i>. Close the browser and open it again.</li>
<li><b>Android:</b> open Settings, search for <i>CA certificate</i> (under Security, then Encryption and credentials, then Install a certificate), choose <i>Install anyway</i> and pick the downloaded file.</li>
<li><b>iPhone or iPad:</b> open this page in Safari and download the file. Then in Settings tap <i>Profile Downloaded</i> and <i>Install</i>. Finally go to Settings, General, About, Certificate Trust Settings and turn on <i>Moonproject local CA</i>.</li>
<li><b>Mac:</b> open the downloaded file, then in Keychain Access open the certificate, expand <i>Trust</i> and choose <i>Always Trust</i>.</li>
</ul>
<h2>4. Open Moonproject</h2>
<p><a class="button" href="${esc(httpsUrl)}/">Open Moonproject</a></p>
<p>Save that address as a bookmark or on the home screen. If the browser still warns that the connection is not private, the certificate is not installed yet.</p>
</body></html>`;
}

/** The plain-HTTP handler: the join page, the CA download, and a redirect to HTTPS for everything else. */
export function joinHandler(o: { caPem: () => string; httpsPort: number; fallbackHost: () => string }) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://join.invalid').pathname;
    const host = requestHost(req.headers.host) ?? o.fallbackHost();
    const httpsUrl = `https://${host}${o.httpsPort === 443 ? '' : `:${o.httpsPort}`}`;
    const common = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...common, Allow: 'GET' }).end();
    } else if (path === CA_FILE) {
      const der = caDer({ certPem: o.caPem() });
      res.writeHead(200, { ...common, 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="moonproject-ca.crt"', 'Content-Length': der.length }).end(req.method === 'HEAD' ? undefined : der);
    } else if (path === '/' || path === '/join') {
      const onServer = req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1';
      res.writeHead(200, { ...common, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" })
        .end(req.method === 'HEAD' ? undefined : page(o.caPem(), httpsUrl, onServer, req.socket.localPort ?? 80));
    } else {
      res.writeHead(301, { ...common, Location: `${httpsUrl}${req.url?.startsWith('/') ? req.url : '/'}` }).end();
    }
  };
}
