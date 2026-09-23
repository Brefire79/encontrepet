// _lib/shared.js — helpers portados de functions/src/index.ts (fonte original).
// Manter em sincronia com js/app-config.js (thresholds e raios — fonte única da UI).

const crypto = require('node:crypto');
const { getAdmin } = require('./firebase');

const MATCH_THRESHOLD = 70;
const SEARCH_RADIUS_KM = { cao: 5, gato: 0.8, outro: 3 };

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function buildWhatsAppLink(phone) {
  const clean = String(phone || '').replace(/\D/g, '');
  const number = clean.startsWith('55') ? clean : `55${clean}`;
  return `https://wa.me/${number}`;
}

async function waitForPrivateAlertData(docId, attempts = 4) {
  const db = getAdmin().firestore();
  for (let i = 0; i < attempts; i++) {
    const snap = await db.collection('alert_privado').doc(docId).get();
    if (snap.exists) return snap.data() || {};
    if (i < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  return {};
}

async function findUserDocByEmail(email) {
  const db = getAdmin().firestore();
  const snap = await db.collection('usuarios')
    .where('email', '==', email)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

// Prova de posse da conta `usuarios/{uid}` pelo chamador (identidade dupla):
// o próprio UID ou um Firebase Auth UID vinculado (firebase_auth_uids — mesmo
// critério do isBoundUser nas rules; o cadastro grava o vínculo e o login-user
// o renova). Sem isto, qualquer autenticado (até anônimo) trocaria a senha de
// outra conta e depois entraria nela pelo login-user.
async function assertOwnsUserDoc(uid, auth) {
  if (uid === auth.uid) return;
  const db = getAdmin().firestore();
  const snap = await db.collection('usuarios').doc(uid).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const bound = Array.isArray(data.firebase_auth_uids) && data.firebase_auth_uids.includes(auth.uid);
  if (!bound) {
    const { HttpsError } = require('./http');
    throw new HttpsError('permission-denied', 'Sem permissão para esta conta.');
  }
}

// SHA-256 + salt — mesmo algoritmo de js/security.js e das CFs.
function verifySha256SaltHash(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const encoded = Buffer.from(salt + password + salt, 'utf8');
  const hash1 = crypto.createHash('sha256').update(encoded).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest('hex');
  return hash2 === hash;
}

// ===== E-mail (nodemailer, opcional — só ativa com SMTP_* nas env vars) =====

function createMailTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  // require tardio: sem SMTP configurado, o módulo nem é carregado.
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user, pass }
  });
}

async function sendMailSafe({ to, subject, html }) {
  const transporter = createMailTransporter();
  if (!transporter) {
    console.warn('[mail] SMTP não configurado — email não enviado para', to);
    return false;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await transporter.sendMail({ from, to, subject, html });
    return true;
  } catch (err) {
    console.error('[mail] falha ao enviar:', err.message);
    return false;
  }
}

function emailShell(inner) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
      <h2 style="color:#2563eb;">🐾 Encontre Pet</h2>
      ${inner}
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;"/>
      <p style="font-size:0.85rem;color:#6b7280;">
        Esta é uma notificação automática do Encontre Pet.<br/>
        Não responda este e-mail.
      </p>
    </div>`;
}

async function sendTutorNotificationEmail({ to, tutorNome, petNome }) {
  return sendMailSafe({
    to,
    subject: `Alguém quer entrar em contato sobre "${petNome}"`,
    html: emailShell(`
      <p>Olá, <strong>${tutorNome || 'tutor'}</strong>!</p>
      <p>
        Alguém encontrou o alerta do seu pet <strong>"${petNome}"</strong>
        no Encontre Pet e tentou entrar em contato, mas não havia telefone ou e-mail
        público cadastrado no alerta.
      </p>
      <p>
        Para facilitar o contato, acesse o app e atualize os dados de contato do seu alerta.<br/>
        Quanto mais informações você fornecer, maior a chance de encontrar seu pet!
      </p>`)
  });
}

async function sendSighterNotificationEmail({ to, sighterNome, petNome }) {
  return sendMailSafe({
    to,
    subject: `O tutor de "${petNome}" quer falar com você!`,
    html: emailShell(`
      <p>Olá, <strong>${sighterNome || 'avistador'}</strong>!</p>
      <p>
        O tutor do pet <strong>"${petNome}"</strong> viu seu avistamento
        no Encontre Pet e tentou entrar em contato, mas não havia telefone ou e-mail
        cadastrado no seu perfil.
      </p>
      <p>
        Acesse o app, veja suas notificações e atualize seus dados de contato
        para facilitar a comunicação com o tutor!
      </p>`)
  });
}

module.exports = {
  MATCH_THRESHOLD,
  SEARCH_RADIUS_KM,
  haversineKm,
  buildWhatsAppLink,
  waitForPrivateAlertData,
  findUserDocByEmail,
  assertOwnsUserDoc,
  verifySha256SaltHash,
  sendTutorNotificationEmail,
  sendSighterNotificationEmail
};
