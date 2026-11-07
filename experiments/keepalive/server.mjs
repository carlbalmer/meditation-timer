// Minimal test server: serves index.html and appends POSTed log batches to log.jsonl.
import { createServer } from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url);
createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const { run, batch = [] } = JSON.parse(body || '{}');
      for (const row of batch) appendFileSync(new URL('log.jsonl', dir), JSON.stringify({ srv: Date.now(), run, ...row }) + '\n');
      res.end('ok');
    });
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.setHeader('cache-control', 'no-store');
  res.end(readFileSync(new URL('index.html', dir)));
}).listen(5180, () => console.log('keepalive test on :5180'));
