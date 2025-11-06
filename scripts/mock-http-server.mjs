#!/usr/bin/env node
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const args = process.argv.slice(2);
let root = process.cwd();
let port = 8080;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '-p' || arg === '--port') {
    port = Number(args[i + 1]) || port;
    i += 1;
  } else if (!arg.startsWith('-')) {
    root = path.resolve(arg);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = url.parse(req.url || '/');
    let pathname = decodeURIComponent(requestUrl.pathname || '/');
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = path.join(root, pathname);
    await stat(filePath);
    const data = await readFile(filePath);
    res.writeHead(200);
    res.end(data);
  } catch (error) {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`mock-http-server: serving ${root} on http://localhost:${port}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
