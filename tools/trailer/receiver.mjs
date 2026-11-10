#!/usr/bin/env node
/**
 * Trailer capture receiver. The page renders the trailer frame by frame and
 * POSTs each frame (JPEG) and the soundtrack (WAV) here; this writes them to
 * disk for ffmpeg. It also serves director.js to the page.
 *
 *   node tools/trailer/receiver.mjs <work-dir> [port]
 *
 * Listens on 127.0.0.1 only and writes only inside <work-dir>.
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = resolve(process.argv[2] ?? 'trailer-work');
const port = Number(process.argv[3] ?? 4391);
const framesDir = join(workDir, 'frames');
await mkdir(framesDir, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

function body(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/director.js') {
      const js = await readFile(join(here, 'director.js'));
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/javascript' }).end(js);
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/status')) {
      const frames = (await readdir(framesDir)).filter((f) => f.endsWith('.jpg')).length;
      res
        .writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, workDir, frames }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/frame') {
      const index = Number(url.searchParams.get('i'));
      if (!Number.isInteger(index) || index < 0 || index > 100000) throw new Error('bad frame index');
      const data = await body(req);
      await writeFile(join(framesDir, `frame_${String(index).padStart(5, '0')}.jpg`), data);
      res.writeHead(200, CORS).end('ok');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/audio') {
      await writeFile(join(workDir, 'audio.wav'), await body(req));
      res.writeHead(200, CORS).end('ok');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/log') {
      await writeFile(join(workDir, 'capture-log.json'), await body(req));
      res.writeHead(200, CORS).end('ok');
      return;
    }
    res.writeHead(404, CORS).end('not found');
  } catch (error) {
    res.writeHead(500, CORS).end(String(error));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`trailer receiver on http://127.0.0.1:${port} -> ${workDir}`);
});
