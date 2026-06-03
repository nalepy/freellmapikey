#!/usr/bin/env node
/**
 * FreeLLMAPIKey CLI
 * Usage:
 *   npx freellmapikey          → setup (if needed) + start
 *   npx freellmapikey setup    → clone + install + build
 *   npx freellmapikey start    → start server (must be set up first)
 *   npx freellmapikey update   → git pull + rebuild
 */
import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const INSTALL_DIR = join(homedir(), '.freellmapikey');
const REPO_URL    = 'https://github.com/nalepy/freellmapikey.git';
const SERVER_DIST = join(INSTALL_DIR, 'server', 'dist', 'index.js');

const cmd = process.argv[2] ?? 'auto';

function run(command, opts = {}) {
  execSync(command, { stdio: 'inherit', ...opts });
}

function isSetUp() {
  return existsSync(SERVER_DIST);
}

function setup() {
  console.log('\n🔧 FreeLLMAPIKey — setting up in', INSTALL_DIR);
  if (!existsSync(INSTALL_DIR)) {
    run(`git clone ${REPO_URL} "${INSTALL_DIR}"`);
  }
  run('npm install', { cwd: INSTALL_DIR });
  run('npm run build', { cwd: INSTALL_DIR });
  console.log('\n✅ Setup complete!\n');
}

function start() {
  if (!isSetUp()) {
    console.error('Not set up. Run: npx freellmapikey setup');
    process.exit(1);
  }
  console.log('\n🚀 FreeLLMAPIKey starting on http://localhost:3001\n');
  const child = spawn(process.execPath, [SERVER_DIST], {
    cwd: INSTALL_DIR,
    stdio: 'inherit',
    env: { ...process.env },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => child.kill('SIGINT'));
}

if (cmd === 'setup') {
  setup();
} else if (cmd === 'start') {
  start();
} else if (cmd === 'update') {
  run(`git -C "${INSTALL_DIR}" pull`);
  run('npm install', { cwd: INSTALL_DIR });
  run('npm run build', { cwd: INSTALL_DIR });
  console.log('\n✅ Updated!\n');
  start();
} else {
  // auto: setup if needed, then start
  if (!isSetUp()) setup();
  start();
}
