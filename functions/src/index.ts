import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import sharp from 'sharp';
import * as nodemailer from 'nodemailer';
import { randomUUID, createHash, randomBytes } from 'crypto';

const blockhashCore = require('blockhash-core');

admin.initializeApp();

// ============================================================
//  SECRETS — Gmail SMTP (configurar via: firebase functions:secrets:set GMAIL_USER)
// ============================================================
const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_PASS = defineSecret('GMAIL_PASS');

const CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'https://encontre-pet-137d2.web.app',
  'https://encontre-pet-137d2.firebaseapp.com',
];

// Rate limit para requisicoes de reset (3 por email a cada 5 min)
const resetRateLimitMap = new Map<string, number[]>();
function checkResetRateLimit(email: string): void {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const maxRequests = 3;
  const timestamps = (resetRateLimitMap.get(email) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    throw new HttpsError('resource-exhausted', 'Muitas solicitacoes. Aguarde alguns minutos.');
  }
  timestamps.push(now);
  resetRateLimitMap.set(email, timestamps);
}

// Replica exatamente o hash SHA-256 duplo de security.js:
// sha256(sha256(salt+password+salt)) — salt: 16 bytes em hex
function buildPasswordHash(password: string): string {
  const saltBytes = randomBytes(16);
  const salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const input = Buffer.from(salt + password + salt, 'utf8');
  const hash1 = createHash('sha256').update(input).digest();
  const hash2 = createHash('sha256').update(hash1).digest('hex');
  return `${salt}:${hash2}`;
}

const ALERTS_PREFIX = 'alerts/';
const IGNORE_SEGMENTS = ['/derived/', '/thumbnails/', '/thumbs/'];

function isImage(contentType?: string | null): boolean {
  return typeof contentType === 'string' && contentType.startsWith('image/');
}

function shouldIgnorePath(pathname: string): boolean {
  if (!pathname.startsWith(ALERTS_PREFIX)) return true;
  const lower = pathname.toLowerCase();
  if (IGNORE_SEGMENTS.some(segment => lower.includes(segment))) return true;
  const filename = pathname.split('/').pop() || '';
  if (filename !== 'original.jpg') return true;
  if (filename.startsWith('thumb_') || filename.startsWith('derived_')) return true;
  return false;
}

function extractAlertId(pathname: string): string | null {
  const match = pathname.match(/^alerts\/([^/]+)\/[^/]+$/i);
  return match?.[1] || null;
}

function ensureRgba(data: Buffer, width: number, height: number, channels: number): Uint8ClampedArray {
  const pixels = width * height;
  const out = new Uint8ClampedArray(pixels * 4);

  for (let i = 0; i < pixels; i++) {
    const src = i * channels;
    const dst = i * 4;

    if (channels === 1) {
      const v = data[src];
      out[dst] = v;
      out[dst + 1] = v;
      out[dst + 2] = v;
      out[dst + 3] = 255;
    } else if (channels === 3) {
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = 255;
    } else {
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = data[src + 3] ?? 255;
    }
  }

  return out;
}

async function generateBlockhash16FromStorage(bucketName: string, objectPath: string): Promise<string> {
  const bucket = admin.storage().bucket(bucketName);
  const file = bucket.file(objectPath);

  const rawResult = await sharp((await file.download())[0])
    .resize(256, 256, { fit: 'cover' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = ensureRgba(rawResult.data, rawResult.info.width, rawResult.info.height, rawResult.info.channels);
  const imageDataLike = {
    data: rgba,
    width: rawResult.info.width,
    height: rawResult.info.height
  };

  const hash = blockhashCore.bmvbhash(imageDataLike, 16);
  return String(hash || '').toLowerCase();
}

async function resolveAlertDocument(alertId: string, explicitCollection?: string | null) {
  const db = admin.firestore();

  if (explicitCollection) {
    const explicitRef = db.collection(explicitCollection).doc(alertId);
    const explicitSnap = await explicitRef.get();
    if (explicitSnap.exists) return explicitRef;
  }

  const collections = ['pets_perdidos', 'avistamentos'];
  for (const collectionName of collections) {
    const ref = db.collection(collectionName).doc(alertId);
    const snap = await ref.get();
    if (snap.exists) return ref;
  }

  return null;
}

export const generateImageHash = onObjectFinalized(
  {
    region: 'southamerica-east1',
    timeoutSeconds: 60,
    memory: '512MiB'
  },
  async (event) => {
    const objectPath = event.data.name;
    const contentType = event.data.contentType;
    const bucketName = event.data.bucket;
    const metadata = event.data.metadata || {};

    if (!objectPath || !bucketName) {
      logger.warn('Evento sem name/bucket. Ignorando.', { objectPath, bucketName });
      return;
    }

    if (!isImage(contentType)) {
      logger.info('Arquivo não é imagem. Ignorando.', { objectPath, contentType });
      return;
    }

    if (shouldIgnorePath(objectPath)) {
      logger.info('Caminho ignorado por regra anti-loop/filtro.', { objectPath });
      return;
    }

    if (metadata.imageHashGenerated === 'true') {
      logger.info('Arquivo já processado (metadata imageHashGenerated).', { objectPath });
      return;
    }

    const alertId = extractAlertId(objectPath);
    if (!alertId) {
      logger.warn('Não foi possível extrair alertId do path.', { objectPath });
      return;
    }

    try {
      const imageHash = await generateBlockhash16FromStorage(bucketName, objectPath);
      if (!imageHash) {
        logger.warn('Hash vazio gerado; ignorando atualização.', { alertId, objectPath });
        return;
      }

      const collectionHint = metadata.collection || metadata.alertCollection || null;
      const alertRef = await resolveAlertDocument(alertId, collectionHint);
      if (!alertRef) {
        logger.warn('Documento de alerta não encontrado para atualizar hash.', { alertId, objectPath, collectionHint });
        return;
      }

      const alertSnap = await alertRef.get();
      const alertData = alertSnap.data() || {};
      if (alertData.imageHashProcessed === true && typeof alertData.imageHash === 'string' && alertData.imageHash.length > 0) {
        logger.info('Alerta já possui hash processado. Ignorando reprocessamento.', { alertId, objectPath });
        return;
      }

      await alertRef.update({
        imageHash,
        imageHashAlgo: 'blockhash16',
        imageHashVersion: 1,
        imageHashCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
        imageHashProcessed: true,
        imageHashSource: 'storage_trigger'
      });

      logger.info('imageHash salvo com sucesso no alerta.', {
        alertId,
        objectPath,
        collection: alertRef.parent.id
      });
    } catch (error) {
      logger.error('Falha ao processar imageHash do upload.', {
        error: error instanceof Error ? error.message : String(error),
        objectPath,
        bucketName,
        alertId
      });
      return;
    }
  }
);

/**
 * getTutorContact — Cloud Function callable (LGPD-compliant)
 * 
 * Permite que um usuário autenticado solicite o contato do tutor de um pet perdido.
 * Os dados sensíveis são lidos pela função com acesso admin e retornados ao solicitante.
 * Um log de auditoria é criado para conformidade LGPD.
 * 
 * Requer: Firebase Auth (anônimo ou logado)
 */

// Rate limit: máximo de requisições por usuário em janela de tempo
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX_REQUESTS = 5;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(uid: string): void {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(uid, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    throw new HttpsError('resource-exhausted', 'Muitas solicitações. Aguarde 1 minuto.');
  }
}

export const getTutorContact = onCall(
  {
    region: 'southamerica-east1',
    maxInstances: 10,
    cors: [
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      'http://localhost:3000',
      'https://encontre-pet-137d2.web.app',
      'https://encontre-pet-137d2.firebaseapp.com',
    ],
  },
  async (request) => {
    // 1. Verificar autenticação
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticação necessária para acessar contato do tutor.');
    }

    const { petId } = request.data;
    if (!petId || typeof petId !== 'string') {
      throw new HttpsError('invalid-argument', 'petId é obrigatório.');
    }

    const db = admin.firestore();
    const requesterUid = request.auth.uid;

    // Rate limit por usuário
    checkRateLimit(requesterUid);

    try {
      // 2. Verificar se o pet existe
      const petRef = db.collection('pets_perdidos').doc(petId);
      const petSnap = await petRef.get();
      if (!petSnap.exists) {
        throw new HttpsError('not-found', 'Pet não encontrado.');
      }

      const petData = petSnap.data();
      if (!petData) {
        throw new HttpsError('not-found', 'Dados do pet não disponíveis.');
      }

      // 3. Verificar se não é o próprio dono tentando acessar (não faz sentido)
      if (petData.owner_firebase_uid === requesterUid) {
        throw new HttpsError('permission-denied', 'Você é o dono deste pet. Use seus dados privados.');
      }

      // 4. Buscar dados privados do tutor (alert_privado)
      const privateRef = db.collection('alert_privado').doc(`pets_perdidos_${petId}`);
      const privateSnap = await privateRef.get();
      const privateData = privateSnap.exists ? privateSnap.data() : null;

      const telefone = privateData?.contato_telefone || petData.contato_telefone || '';
      // Respeitar flag de email público — só expor email se explicitamente ativado
      const emailPublicoAtivo = petData.email_publico_ativo === true || petData.contato_email_publico_ativo === true;
      const email = emailPublicoAtivo ? (privateData?.contato_email || petData.contato_email || '') : '';
      const nome = petData.contato_nome || petData.nome_pet || '';

      if (!telefone && !email) {
        return { telefone: '', email: '', nome: '', available: false };
      }

      // 5. Log de auditoria LGPD
      await db.collection('lgpd_access_log').add({
        tipo: 'contato_tutor_acesso',
        petId,
        petNome: petData.nome_pet || '',
        requesterFirebaseUid: requesterUid,
        dadosAcessados: ['telefone', 'email', 'nome'].filter(k => {
          if (k === 'telefone') return !!telefone;
          if (k === 'email') return !!email;
          if (k === 'nome') return !!nome;
          return false;
        }),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: request.rawRequest?.ip || ''
      });

      logger.info('Contato do tutor acessado via getTutorContact.', {
        petId,
        requesterUid,
        campos: [telefone ? 'telefone' : '', email ? 'email' : '', nome ? 'nome' : ''].filter(Boolean)
      });

      // 6. Notificar o dono que alguém acessou seus dados
      if (petData.owner_uid) {
        await db.collection('notificacoes').add({
          tipo: 'contato_acessado',
          pet_id: petId,
          pet_nome: petData.nome_pet || 'Pet',
          mensagem: `Alguém visualizou seu contato referente a "${petData.nome_pet || 'seu pet'}"`,
          data: new Date().toISOString(),
          lida: false,
          destinatario_uid: petData.owner_uid
        });
      }

      return {
        telefone: telefone || '',
        email: email || '',
        nome: nome || '',
        available: true
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Erro ao buscar contato do tutor.', {
        error: error instanceof Error ? error.message : String(error),
        petId,
        requesterUid
      });
      throw new HttpsError('internal', 'Erro ao buscar contato do tutor.');
    }
  }
);

// ============================================================
//  requestPasswordReset — envia e-mail de recuperacao de senha
//  Nao requer autenticacao (usuario esqueceu a senha)
// ============================================================
export const requestPasswordReset = onCall(
  {
    region: 'southamerica-east1',
    maxInstances: 10,
    cors: CORS_ORIGINS,
    secrets: [GMAIL_USER, GMAIL_PASS],
  },
  async (request) => {
    const { email, origin } = request.data;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'E-mail invalido.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    checkResetRateLimit(normalizedEmail);

    const db = admin.firestore();

    // Verificar se usuario existe
    const snapshot = await db.collection('usuarios')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    // Retornar sucesso mesmo se nao existir (evita enumeracao de e-mails)
    if (snapshot.empty) {
      logger.info('Password reset: email not found', { email: normalizedEmail });
      return { success: true };
    }

    // Gerar token UUID e salvar no Firestore (validade: 1 hora)
    const token = randomUUID();
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);

    await db.collection('password_resets').doc(token).set({
      email: normalizedEmail,
      expiresAt,
      used: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Montar URL de reset (usa origin do cliente se for confiavel)
    const appUrl = typeof origin === 'string' && CORS_ORIGINS.includes(origin)
      ? origin
      : 'https://encontre-pet-137d2.web.app';
    const resetLink = `${appUrl}/?reset=${token}`;

    // Enviar e-mail via Gmail SMTP
    const gmailUser = GMAIL_USER.value();
    const gmailPass = GMAIL_PASS.value();

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
      from: `"Encontre Pet" <${gmailUser}>`,
      to: normalizedEmail,
      subject: 'Recuperacao de senha — Encontre Pet',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f9f9f9;border-radius:12px;overflow:hidden">
          <div style="background:#FF6B35;padding:32px 24px;text-align:center">
            <div style="font-size:48px;margin-bottom:8px">🐾</div>
            <h1 style="color:#fff;margin:0;font-size:24px">Encontre Pet</h1>
            <p style="color:rgba(255,255,255,0.85);margin:4px 0 0">Recuperacao de senha</p>
          </div>
          <div style="padding:32px 24px;background:#fff">
            <p style="color:#333;font-size:16px;margin:0 0 16px">Ola!</p>
            <p style="color:#555;font-size:15px;margin:0 0 24px">
              Recebemos uma solicitacao para redefinir a senha da sua conta no Encontre Pet.
              Clique no botao abaixo para criar uma nova senha:
            </p>
            <div style="text-align:center;margin:28px 0">
              <a href="${resetLink}"
                 style="background:#FF6B35;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;display:inline-block">
                Redefinir minha senha
              </a>
            </div>
            <p style="color:#888;font-size:13px;margin:24px 0 0">
              Este link expira em <strong>1 hora</strong>.<br>
              Se voce nao solicitou a recuperacao, ignore este e-mail — sua senha permanece a mesma.
            </p>
          </div>
          <div style="background:#f0f0f0;padding:16px 24px;text-align:center">
            <p style="color:#aaa;font-size:12px;margin:0">Encontre Pet — Ajudando a reunir familias</p>
          </div>
        </div>
      `,
    });

    logger.info('Password reset email sent', { email: normalizedEmail });
    return { success: true };
  }
);

// ============================================================
//  confirmPasswordReset — valida token e salva nova senha
// ============================================================
export const confirmPasswordReset = onCall(
  {
    region: 'southamerica-east1',
    maxInstances: 10,
    cors: CORS_ORIGINS,
  },
  async (request) => {
    const { token, newPassword } = request.data;

    if (!token || typeof token !== 'string') {
      throw new HttpsError('invalid-argument', 'Token invalido.');
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new HttpsError('invalid-argument', 'A nova senha deve ter pelo menos 6 caracteres.');
    }
    if (newPassword.length > 128) {
      throw new HttpsError('invalid-argument', 'Senha muito longa.');
    }

    const db = admin.firestore();
    const tokenRef = db.collection('password_resets').doc(token);
    const tokenSnap = await tokenRef.get();

    if (!tokenSnap.exists) {
      throw new HttpsError('not-found', 'Link de recuperacao invalido ou ja utilizado.');
    }

    const tokenData = tokenSnap.data()!;

    if (tokenData.used) {
      throw new HttpsError('already-exists', 'Este link ja foi utilizado. Solicite um novo.');
    }

    const now = admin.firestore.Timestamp.now();
    if (tokenData.expiresAt.toMillis() < now.toMillis()) {
      await tokenRef.delete();
      throw new HttpsError('deadline-exceeded', 'Link expirado. Solicite um novo.');
    }

    // Buscar usuario pelo e-mail
    const snapshot = await db.collection('usuarios')
      .where('email', '==', tokenData.email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new HttpsError('not-found', 'Usuario nao encontrado.');
    }

    // Gerar novo hash (mesmo algoritmo de security.js)
    const userDoc = snapshot.docs[0];
    const newHash = buildPasswordHash(newPassword);

    await userDoc.ref.update({
      senha_hash: newHash,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Deletar token apos uso
    await tokenRef.delete();

    logger.info('Password reset successful', { email: tokenData.email, uid: userDoc.id });
    return { success: true };
  }
);
