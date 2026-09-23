#!/usr/bin/env node
/**
 * netlify-ep — roda a CLI do Netlify SEMPRE com a conta do Encontre Pet
 * (encontrepet26@gmail.com), sem trocar a conta padrão da máquina.
 *
 * A CLI do Netlify não tem conta por pasta (o `netlify switch` é global).
 * Este atalho lê o token dessa conta no cadastro local da própria CLI
 * (%APPDATA%\netlify\Config\config.json, criado pelo `netlify login --new`)
 * e o repassa via NETLIFY_AUTH_TOKEN só para o processo filho. O token não
 * é impresso nem gravado em nenhum arquivo do projeto.
 *
 * Uso:
 *   npm run netlify -- status
 *   npm run netlify -- env:list
 *   npm run netlify -- deploy --prod
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ACCOUNT_EMAIL = 'encontrepet26@gmail.com';

function configPath() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'netlify', 'Config', 'config.json'),
    path.join(os.homedir(), 'Library', 'Preferences', 'netlify', 'config.json'),
    path.join(os.homedir(), '.config', 'netlify', 'config.json')
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p));
}

const cfgFile = configPath();
if (!cfgFile) {
  console.error('[netlify-ep] Cadastro da CLI do Netlify não encontrado. Rode: npx netlify login --new');
  process.exit(1);
}

const users = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).users || {};
const user = Object.values(users).find(u => (u.email || '').toLowerCase() === ACCOUNT_EMAIL);
const token = user && user.auth && user.auth.token;
if (!token) {
  console.error(`[netlify-ep] Conta ${ACCOUNT_EMAIL} não cadastrada na CLI. Rode: npx netlify login --new`);
  process.exit(1);
}

// CLI local (devDependency) executada direto pelo Node — sem shell.
const cliBin = path.join(__dirname, '..', 'node_modules', 'netlify-cli', 'bin', 'run.js');
if (!fs.existsSync(cliBin)) {
  console.error('[netlify-ep] netlify-cli não instalado. Rode: npm install');
  process.exit(1);
}

const child = spawn(process.execPath, [cliBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NETLIFY_AUTH_TOKEN: token }
});
child.on('exit', code => process.exit(code ?? 1));
