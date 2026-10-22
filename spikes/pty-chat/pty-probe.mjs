#!/usr/bin/env node
// Spike #17: startet agy/codex interaktiv in einem PTY, injiziert Eingaben
// und protokolliert Rohausgabe + gerenderten Bildschirm (xterm headless).
//
// Aufruf (Abhängigkeiten liegen im aktuellen Verzeichnis, nicht im Repo):
//   node pty-probe.mjs <agy|codex> [eingabe ...]
// Jede Eingabe wird als Text + Enter gesendet, sobald die Ausgabe 4s ruhig ist.
// "" sendet nur Enter, "^C" sendet Ctrl-C.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'noop.js'));
const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');

const PROMPT =
  'Stelle mir zuerst genau eine Ja/Nein-Rückfrage und warte auf meine Antwort. ' +
  'Nach meiner Antwort antworte nur mit OK. Benutze keine Tools.';

const [agent, ...steps] = process.argv.slice(2);
const cmds = {
  // Kein --dangerously-skip-permissions; Plan-Modus, damit nichts geschrieben wird.
  agy: ['agy', ['--mode', 'plan', '-i', PROMPT]],
  codex: ['codex', ['-s', 'read-only', '-a', 'on-request', PROMPT]],
};
if (!cmds[agent]) {
  console.error('Usage: node pty-probe.mjs <agy|codex> [eingabe ...]');
  process.exit(1);
}

const cwd = mkdtempSync(join(process.cwd(), `run-${agent}-`));
const raw = join(cwd, 'raw.log');
const cols = 120;
const rows = 40;
const term = new Terminal({ cols, rows, allowProposedApi: true });
const p = pty.spawn(cmds[agent][0], cmds[agent][1], {
  name: 'xterm-256color',
  cols,
  rows,
  cwd,
  env: process.env,
});
console.log(`pid=${p.pid} cwd=${cwd}`);

let last = Date.now();
let bytes = 0;
p.onData((d) => {
  last = Date.now();
  bytes += d.length;
  appendFileSync(raw, d);
  term.write(d);
});
let exitCode = null;
p.onExit((e) => (exitCode = e.exitCode));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function quiet(ms = 4000, max = 120000) {
  const start = Date.now();
  while (exitCode === null && Date.now() - start < max) {
    if (Date.now() - last > ms) return;
    await sleep(250);
  }
}
function screen(label) {
  const b = term.buffer.active;
  const lines = [];
  for (let i = 0; i < b.length; i++)
    lines.push(b.getLine(i).translateToString(true));
  const text = lines.join('\n').replace(/\n+$/, '');
  writeFileSync(join(cwd, `screen-${label}.txt`), text + '\n');
  console.log(
    `\n===== ${label} (bytes=${bytes}, buffer=${b.type}) =====\n${text}`,
  );
}

await quiet();
screen('0-start');
let n = 1;
for (const s of steps) {
  if (s === '^C') p.write('\x03');
  else {
    if (s) p.write(s);
    await sleep(300); // TUIs werten schnellen Text+Enter teils als Paste
    p.write('\r');
  }
  await quiet();
  screen(`${n++}-after-${s || 'enter'}`);
}

const out = String(require('node:fs').readFileSync(raw));
const count = (re) => (out.match(re) || []).length;
const stats = {
  bytes,
  altScreen: out.includes('\x1b[?1049h'),
  cursorMoves: count(/\x1b\[\d*;?\d*H/g),
  eraseLine: count(/\x1b\[\d*K/g),
  sgr: count(/\x1b\[[\d;]*m/g),
  exitCode,
};
console.log('\nstats', JSON.stringify(stats));
writeFileSync(join(cwd, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');

// node-pty macht das Kind zum Session-Leader: ganze Prozessgruppe beenden.
const killGroup = (sig) => {
  try {
    process.kill(-p.pid, sig);
  } catch {}
};
killGroup('SIGTERM');
await sleep(1500);
killGroup('SIGKILL');
process.exit(0);
