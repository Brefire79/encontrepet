import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import sharp from 'sharp';
import * as nodemailer from 'nodemailer';

const blockhashCore = require('blockhash-core');

admin.initializeApp();

const MATCH_THRESHOLD = 70;

// [FIX C9] Lista CORS compartilhada por TODAS as Cloud Functions HTTPS callable.
// Antes apenas getTutorContact/getSighterContact tinham CORS configurado e
// saveUserPassword/verifyUserPassword falhavam no preflight com
// "No 'Access-Control-Allow-Origin' header is present".
// Tambem adicionado http://localhost:8888 para suportar Netlify Dev.
const ALLOWED_CORS_ORIGINS: (string | RegExp)[] = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:8888',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8888',
  'https://encontre-pet-137d2.web.app',
  'https://encontre-pet-137d2.firebaseapp.com',
  'https://encontrepet.netlify.app',
  /^https:\/\/.*\.netlify\.app$/,
];

async function waitForPrivateAlertData(docId: string, attempts = 4) {
  const db = admin.firestore();
  for (let i = 0; i < attempts; i++) {
    const snap = await db.collection('alert_privado').doc(docId).get();
    if (snap.exists) return snap.data() || {};
    if (i < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  return {};
}

function buildWhatsAppLink(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  const number = clean.startsWith('55') ? clean : `55${clean}`;
  return `https://wa.me/${number}`;
}

// ============================================================
//  EMAIL — Nodemailer SMTP
//  Configure via Firebase Functions env vars:
//    firebase functions:secrets:set SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM
//  Or via .env file (Functions v2): SMTP_HOST=... SMTP_USER=... etc.
// ============================================================

function createMailTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user, pass }
  });
}

async function sendSighterNotificationEmail(opts: {
  to: string;
  sighterNome: string;
  petNome: string;
}): Promise<boolean> {
  const transporter = createMailTransporter();
  if (!transporter) {
    logger.warn('SMTP não configurado — email ao avistador não enviado.', { to: opts.to });
    return false;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = `O tutor de "${opts.petNome}" quer falar com você!`;
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
      <h2 style="color:#2563eb;">🐾 Encontre Pet</h2>
      <p>Olá, <strong>${opts.sighterNome || 'avistador'}</strong>!</p>
      <p>
        O tutor do pet <strong>"${opts.petNome}"</strong> viu seu avistamento
        no Encontre Pet e tentou entrar em contato, mas não havia telefone ou e-mail
        cadastrado no seu perfil.
      </p>
      <p>
        Acesse o app, veja suas notificações e atualize seus dados de contato
        para facilitar a comunicação com o tutor!
      </p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;"/>
      <p style="font-size:0.85rem;color:#6b7280;">
        Esta é uma notificação automática do Encontre Pet.<br/>
        Não responda este e-mail.
      </p>
    </div>`;
  try {
    await transporter.sendMail({ from, to: opts.to, subject, html });
    logger.info('E-mail de notificação enviado ao avistador.', { to: opts.to, petNome: opts.petNome });
    return true;
  } catch (err) {
    logger.error('Falha ao enviar e-mail ao avistador.', {
      error: err instanceof Error ? err.message : String(err),
      to: opts.to
    });
    return false;
  }
}

async function sendTutorNotificationEmail(opts: {
  to: string;
  tutorNome: string;
  petNome: string;
}): Promise<boolean> {
  const transporter = createMailTransporter();
  if (!transporter) {
    logger.warn('SMTP não configurado — email de notificação não enviado.', { to: opts.to });
    return false;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = `Alguém quer entrar em contato sobre "${opts.petNome}"`;
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
      <h2 style="color:#2563eb;">🐾 Encontre Pet</h2>
      <p>Olá, <strong>${opts.tutorNome || 'tutor'}</strong>!</p>
      <p>
        Alguém encontrou o alerta do seu pet <strong>"${opts.petNome}"</strong>
        no Encontre Pet e tentou entrar em contato, mas não havia telefone ou e-mail
        público cadastrado no alerta.
      </p>
      <p>
        Para facilitar o contato, acesse o app e atualize os dados de contato do seu alerta.<br/>
        Quanto mais informações você fornecer, maior a chance de encontrar seu pet!
      </p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;"/>
      <p style="font-size:0.85rem;color:#6b7280;">
        Esta é uma notificação automática do Encontre Pet.<br/>
        Não responda este e-mail.
      </p>
    </div>`;
  try {
    await transporter.sendMail({ from, to: opts.to, subject, html });
    logger.info('E-mail de notificação enviado ao tutor.', { to: opts.to, petNome: opts.petNome });
    return true;
  } catch (err) {
    logger.error('Falha ao enviar e-mail de notificação.', {
      error: err instanceof Error ? err.message : String(err),
      to: opts.to
    });
    return false;
  }
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

export const onAvistamentoCreated = onDocumentCreated(
  {
    document: 'avistamentos/{avistamentoId}',
    region: 'southamerica-east1'
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const avistamento = snap.data();
    const avistamentoId = event.params.avistamentoId;
    const db = admin.firestore();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const petId = avistamento.pet_perdido_id || avistamento.matchedLostPetId || '';
    const rawScore = avistamento.match_score ?? avistamento.matchedScore ?? avistamento.match_percentual ?? 0;
    const matchScore = typeof rawScore === 'number' ? rawScore : Number(rawScore) || 0;
    const avistadorUid = avistamento.owner_firebase_uid || '';
    const avistadorOwnerUid = avistamento.owner_uid || '';

    if (!petId) {
      await db.collection('lgpd_access_log').add({
        tipo: 'avistamento_registrado',
        petId: '',
        avistamentoId,
        avistadorUid,
        matchScore,
        threshold: MATCH_THRESHOLD,
        timestamp
      });
      return;
    }

    const petDoc = await db.collection('pets_perdidos').doc(petId).get();
    if (!petDoc.exists) return;
    const pet = petDoc.data() || {};

    const tutorUid = pet.owner_firebase_uid || pet.destinatario_firebase_uid || '';
    const tutorOwnerUid = pet.owner_uid || '';
    const petNome = pet.nome || pet.nome_pet || 'seu pet';

    const tutorPrivateDocId = `pets_perdidos_${petId}`;
    const tutorPrivateData = await waitForPrivateAlertData(tutorPrivateDocId, 1);
    const avistadorPrivateDocId = `avistamentos_${avistamentoId}`;
    const avistadorPrivateData = await waitForPrivateAlertData(avistadorPrivateDocId);

    const tutorTelefone = tutorPrivateData.contato_telefone || pet.contato_telefone || pet.telefone_publico || '';
    const tutorEmail = tutorPrivateData.contato_email || pet.contato_email || pet.contato_email_publico || '';
    const tutorNome = tutorPrivateData.contato_nome || pet.contato_nome || pet.tutorNome || 'Tutor';
    const tutorTelPublico = pet.telefone_publico_ativo ?? true;
    const tutorEmailPublico = pet.email_publico_ativo === true || pet.contato_email_publico_ativo === true;

    const avistadorTelefone = avistadorPrivateData.contato_telefone || avistamento.telefone_publico || '';
    const avistadorNome = avistadorPrivateData.reportado_por || avistamento.reportado_por || 'Avistador';
    const avistadorTelPublico = avistamento.telefone_publico_ativo === true;

    const isHighMatch = matchScore >= MATCH_THRESHOLD;
    const conversaId = `${petId}_${avistamentoId}`;

    await db.collection('lgpd_access_log').add({
      tipo: isHighMatch ? 'match_alto_bilateral' : 'avistamento_registrado',
      petId,
      avistamentoId,
      avistadorUid,
      tutorUid,
      matchScore,
      threshold: MATCH_THRESHOLD,
      timestamp
    });

    if (!isHighMatch) {
      await db.collection('notificacoes').add({
        tipo: 'avistamento_registrado',
        destinatario_uid: tutorOwnerUid || tutorUid,
        destinatario_firebase_uid: tutorUid,
        owner_firebase_uid: tutorUid,
        petId,
        pet_id: petId,
        petNome,
        pet_nome: petNome,
        avistamentoId,
        avistamento_id: avistamentoId,
        matchScore,
        mensagem: `Novo avistamento de ${petNome} registrado (compatibilidade ${matchScore}%)`,
        lida: false,
        timestamp
      });
      return;
    }

    await db.collection('conversas').doc(conversaId).set({
      petId,
      petNome,
      avistamentoId,
      matchScore,
      participantes_firebase_uids: [tutorUid, avistadorUid].filter(Boolean),
      participantes_owner_uids: [tutorOwnerUid, avistadorOwnerUid].filter(Boolean),
      tutorUid,
      tutorOwnerUid,
      tutorNome,
      avistadorUid,
      avistadorOwnerUid,
      avistadorNome,
      status: 'ativa',
      origem: 'match_alto_bilateral',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessage: '',
      lastMessageAt: null
    }, { merge: true });

    const notifTutor: Record<string, any> = {
      tipo: 'match_alto_para_tutor',
      destinatario_uid: tutorOwnerUid || tutorUid,
      destinatario_firebase_uid: tutorUid,
      owner_firebase_uid: tutorUid,
      petId,
      pet_id: petId,
      petNome,
      pet_nome: petNome,
      avistamentoId,
      avistamento_id: avistamentoId,
      conversaId,
      conversa_id: conversaId,
      matchScore,
      avistadorNome,
      lida: false,
      timestamp
    };
    if (avistadorTelPublico && avistadorTelefone) {
      notifTutor.contato_telefone_avistador = avistadorTelefone;
      notifTutor.whatsapp_link = buildWhatsAppLink(avistadorTelefone);
    }
    await db.collection('notificacoes').add(notifTutor);

    const notifAvistador: Record<string, any> = {
      tipo: 'match_alto_para_avistador',
      destinatario_uid: avistadorOwnerUid || avistadorUid,
      destinatario_firebase_uid: avistadorUid,
      owner_firebase_uid: avistadorUid,
      petId,
      pet_id: petId,
      petNome,
      pet_nome: petNome,
      avistamentoId,
      avistamento_id: avistamentoId,
      conversaId,
      conversa_id: conversaId,
      matchScore,
      tutorNome,
      lida: false,
      timestamp
    };
    if (tutorTelPublico && tutorTelefone) {
      notifAvistador.contato_telefone_tutor = tutorTelefone;
      notifAvistador.whatsapp_link = buildWhatsAppLink(tutorTelefone);
    }
    if (tutorEmailPublico && tutorEmail) {
      notifAvistador.contato_email_tutor = tutorEmail;
    }
    await db.collection('notificacoes').add(notifAvistador);

    await snap.ref.update({
      match_confirmado: true,
      match_score: matchScore,
      conversaId,
      contato_revelado_em: timestamp
    });

    await db.collection('lgpd_access_log').add({
      tipo: 'contato_revelado_bilateral',
      petId,
      avistamentoId,
      avistadorUid,
      tutorUid,
      matchScore,
      camposReveladosParaTutor: avistadorTelPublico && avistadorTelefone ? ['telefone_avistador'] : [],
      camposReveladosParaAvistador: [
        ...(tutorTelPublico && tutorTelefone ? ['telefone_tutor'] : []),
        ...(tutorEmailPublico && tutorEmail ? ['email_tutor'] : [])
      ],
      timestamp
    });
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
    // [FIX C9] Usa lista CORS compartilhada (inclui localhost:8888 do Netlify Dev)
    cors: ALLOWED_CORS_ORIGINS,
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

      // 3b. Verificar se o solicitante tem um avistamento vinculado a este pet (S-05)
      // Impede que qualquer usuário acesse contatos sem ter registrado um avistamento
      const sightingSnap = await db.collection('avistamentos')
        .where('owner_firebase_uid', '==', requesterUid)
        .where('pet_perdido_id', '==', petId)
        .limit(1)
        .get();

      if (sightingSnap.empty) {
        // Avistamento não vinculado — verificar se há avistamento com match score >= 70%
        const highScoreSnap = await db.collection('avistamentos')
          .where('owner_firebase_uid', '==', requesterUid)
          .where('matchedLostPetId', '==', petId)
          .limit(1)
          .get();

        if (highScoreSnap.empty) {
          throw new HttpsError(
            'permission-denied',
            'Registre um avistamento deste pet antes de solicitar o contato do tutor.'
          );
        }
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
        // Sem contato público — buscar e-mail do perfil do tutor e notificá-lo
        let tutorEmail = '';
        let tutorNome = nome;
        try {
          // Buscar pelo owner_firebase_uid primeiro, depois pelo owner_uid (u_xxx)
          if (petData.owner_firebase_uid) {
            const userSnap = await db.collection('usuarios')
              .where('owner_firebase_uid', '==', petData.owner_firebase_uid)
              .limit(1).get();
            if (!userSnap.empty) {
              const u = userSnap.docs[0].data();
              tutorEmail = u.email || '';
              tutorNome = u.nome || tutorNome;
            }
          }
          // Fallback: buscar pelo id do documento (owner_uid é o doc id)
          if (!tutorEmail && petData.owner_uid) {
            const ownerDoc = await db.collection('usuarios').doc(petData.owner_uid).get();
            if (ownerDoc.exists) {
              const u = ownerDoc.data()!;
              tutorEmail = u.email || '';
              tutorNome = u.nome || tutorNome;
            }
          }
        } catch (lookupErr) {
          logger.warn('Falha ao buscar email do tutor em usuarios.', {
            error: lookupErr instanceof Error ? lookupErr.message : String(lookupErr)
          });
        }

        let emailSent = false;
        if (tutorEmail) {
          emailSent = await sendTutorNotificationEmail({
            to: tutorEmail,
            tutorNome,
            petNome: petData.nome_pet || 'seu pet'
          });
          // Log LGPD do envio de e-mail
          await db.collection('lgpd_access_log').add({
            tipo: 'contato_email_notificacao',
            petId,
            petNome: petData.nome_pet || '',
            requesterFirebaseUid: requesterUid,
            tutorEmail: tutorEmail.replace(/(.{2}).+(@.+)/, '$1***$2'), // mascarado
            emailSent,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: request.rawRequest?.ip || ''
          });
        }

        return { telefone: '', email: '', nome: tutorNome, available: false, emailSent };
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
      // destinatario_firebase_uid habilita as Firestore Rules (S-02) a validar acesso por Firebase UID
      if (petData.owner_uid || petData.owner_firebase_uid) {
        await db.collection('notificacoes').add({
          tipo: 'contato_acessado',
          pet_id: petId,
          pet_nome: petData.nome_pet || 'Pet',
          mensagem: `Alguém visualizou seu contato referente a "${petData.nome_pet || 'seu pet'}"`,
          data: new Date().toISOString(),
          lida: false,
          destinatario_uid: petData.owner_uid || '',
          destinatario_firebase_uid: petData.owner_firebase_uid || '',
          owner_firebase_uid: petData.owner_firebase_uid || ''
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
//  saveUserPassword — armazena senha_hash em colecao privada
//  Chamado no cadastro. A colecao senhas_usuarios tem
//  allow read,write: if false nos Firestore Rules.
//  Apenas o admin SDK acessa. (S-03)
// ============================================================

export const saveUserPassword = onCall(
  {
    region: 'southamerica-east1',
    maxInstances: 10,
    // [FIX C9] CORS adicionado — antes esta funcao falhava com erro de preflight
    // ao ser chamada do browser. O fluxo de cadastro caia silenciosamente no
    // catch e a senha so era salva no Firestore publico (regressao para S-03).
    cors: ALLOWED_CORS_ORIGINS,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticacao necessaria.');
    }
    const { uid, senhaHash } = request.data as { uid: string; senhaHash: string };
    if (!uid || !senhaHash || typeof uid !== 'string' || typeof senhaHash !== 'string') {
      throw new HttpsError('invalid-argument', 'uid e senhaHash sao obrigatorios.');
    }
    const db = admin.firestore();
    await db.collection('senhas_usuarios').doc(uid).set({
      senhaHash,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ownerFirebaseUid: request.auth.uid
    }, { merge: true });
    logger.info('Senha salva em senhas_usuarios.', { uid: uid.substring(0, 8) });
    return { success: true };
  }
);

// ============================================================
//  verifyUserPassword — verifica senha sem expor o hash
//  Substitui a verificacao local em auth.js que lia senha_hash
//  da colecao publica usuarios (S-03).
// ============================================================

const loginRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(key: string): void {
  const now = Date.now();
  const entry = loginRateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    loginRateLimitMap.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  entry.count++;
  if (entry.count > 10) {
    throw new HttpsError('resource-exhausted', 'Muitas tentativas de login. Aguarde 1 minuto.');
  }
}

export const verifyUserPassword = onCall(
  {
    region: 'southamerica-east1',
    maxInstances: 10,
    // [FIX C9] CORS adicionado — antes o browser caia no fallback Firestore
    // direto (menos seguro) porque a chamada falhava no preflight.
    cors: ALLOWED_CORS_ORIGINS,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticacao necessaria.');
    }
    const { uid, password } = request.data as { uid: string; password: string };
    if (!uid || !password) {
      throw new HttpsError('invalid-argument', 'uid e password sao obrigatorios.');
    }

    checkLoginRateLimit(request.auth.uid);

    const db = admin.firestore();
    const doc = await db.collection('senhas_usuarios').doc(uid).get();
    if (!doc.exists) {
      throw new HttpsError('unauthenticated', 'Credenciais invalidas.');
    }
    const storedHash: string = doc.data()?.senhaHash || '';
    if (!storedHash || !storedHash.includes(':')) {
      throw new HttpsError('unauthenticated', 'Credenciais invalidas.');
    }

    // Verificar hash SHA-256 + salt (mesmo algoritmo de security.js)
    const [salt, hash] = storedHash.split(':');
    const nodeCrypto = await import('node:crypto');
    const encoded = Buffer.from(salt + password + salt, 'utf8');
    const hash1 = nodeCrypto.createHash('sha256').update(encoded).digest();
    const hash2 = nodeCrypto.createHash('sha256').update(hash1).digest('hex');

    if (hash2 !== hash) {
      throw new HttpsError('unauthenticated', 'Credenciais invalidas.');
    }
    logger.info('Senha verificada via CF.', { uid: uid.substring(0, 8) });
    return { valid: true };
  }
);

// ============================================================
//  getSighterContact — retorna contato do avistador para o tutor
//  Fluxo bidirecional: tutor pode contatar quem avistou seu pet
//  Requer: Firebase Auth + ser dono do pet + avistamento vinculado
// ============================================================

export const getSighterContact = onCall(
  {
    region: 'southamerica-east1',
    maxInstances: 10,
    // [FIX C9] Usa lista CORS compartilhada (inclui localhost:8888 do Netlify Dev)
    cors: ALLOWED_CORS_ORIGINS,
  },
  async (request) => {
    // 1. Autenticacao obrigatoria
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Autenticacao necessaria para acessar contato do avistador.');
    }

    const { sightingId, petId } = request.data as { sightingId: string; petId: string };
    if (!sightingId || !petId || typeof sightingId !== 'string' || typeof petId !== 'string') {
      throw new HttpsError('invalid-argument', 'sightingId e petId sao obrigatorios.');
    }

    const db = admin.firestore();
    const tutorUid = request.auth.uid;

    // Rate limit por tutor
    checkRateLimit(tutorUid);

    try {
      // 2. Verificar pet e confirmar que o chamador e o dono
      const petSnap = await db.collection('pets_perdidos').doc(petId).get();
      if (!petSnap.exists) {
        throw new HttpsError('not-found', 'Pet nao encontrado.');
      }
      const petData = petSnap.data()!;
      if (petData.owner_firebase_uid !== tutorUid) {
        throw new HttpsError('permission-denied', 'Apenas o tutor deste pet pode acessar o contato do avistador.');
      }

      // 3. Verificar avistamento e confirmar vinculo com o pet
      const sightingSnap = await db.collection('avistamentos').doc(sightingId).get();
      if (!sightingSnap.exists) {
        throw new HttpsError('not-found', 'Avistamento nao encontrado.');
      }
      const sightingData = sightingSnap.data()!;
      if (sightingData.pet_perdido_id !== petId && sightingData.matchedLostPetId !== petId) {
        throw new HttpsError('permission-denied', 'Este avistamento nao esta vinculado ao seu pet.');
      }

      // 4. Buscar dados privados do avistador (alert_privado)
      const privadoSnap = await db.collection('alert_privado').doc(`avistamentos_${sightingId}`).get();
      const privadoData = privadoSnap.exists ? privadoSnap.data() : null;

      const nome = sightingData.reportado_por || '';
      const telefonePublicoAtivo = sightingData.telefone_publico_ativo === true;
      const telefone = telefonePublicoAtivo
        ? (privadoData?.contato_telefone || sightingData.telefone_publico || '')
        : '';
      const email = privadoData?.contato_email || '';

      if (!telefone && !email) {
        // Sem contato — buscar e-mail do perfil do avistador em usuarios e notifica-lo
        let sighterEmail = '';
        let sighterNome = nome;
        try {
          if (sightingData.owner_uid) {
            const usuarioDoc = await db.collection('usuarios').doc(sightingData.owner_uid).get();
            if (usuarioDoc.exists) {
              const u = usuarioDoc.data()!;
              sighterEmail = u.email || '';
              sighterNome = u.nome || sighterNome;
            }
          }
          if (!sighterEmail && sightingData.owner_firebase_uid) {
            const snap = await db.collection('usuarios')
              .where('owner_firebase_uid', '==', sightingData.owner_firebase_uid)
              .limit(1).get();
            if (!snap.empty) {
              const u = snap.docs[0].data();
              sighterEmail = u.email || '';
              sighterNome = u.nome || sighterNome;
            }
          }
        } catch (lookupErr) {
          logger.warn('Falha ao buscar email do avistador em usuarios.', {
            error: lookupErr instanceof Error ? lookupErr.message : String(lookupErr)
          });
        }

        let emailSent = false;
        if (sighterEmail) {
          emailSent = await sendSighterNotificationEmail({
            to: sighterEmail,
            sighterNome,
            petNome: petData.nome_pet || 'um pet'
          });
          await db.collection('lgpd_access_log').add({
            tipo: 'contato_avistador_email_notificacao',
            petId,
            sightingId,
            petNome: petData.nome_pet || '',
            tutorFirebaseUid: tutorUid,
            sighterEmail: sighterEmail.replace(/(.{2}).+(@.+)/, '$1***$2'),
            emailSent,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: request.rawRequest?.ip || ''
          });
        }

        return { telefone: '', email: '', nome: sighterNome, available: false, emailSent };
      }

      // 5. Log LGPD
      await db.collection('lgpd_access_log').add({
        tipo: 'contato_avistador_acesso',
        petId,
        sightingId,
        petNome: petData.nome_pet || '',
        tutorFirebaseUid: tutorUid,
        dadosAcessados: ['telefone', 'email', 'nome'].filter(k => {
          if (k === 'telefone') return !!telefone;
          if (k === 'email') return !!email;
          if (k === 'nome') return !!nome;
          return false;
        }),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: request.rawRequest?.ip || ''
      });

      logger.info('Contato do avistador acessado pelo tutor.', { petId, sightingId, tutorUid });

      // 6. Notificar o avistador que o tutor acessou seu contato
      if (sightingData.owner_uid || sightingData.owner_firebase_uid) {
        await db.collection('notificacoes').add({
          tipo: 'contato_acessado_pelo_tutor',
          pet_id: petId,
          avistamento_id: sightingId,
          pet_nome: petData.nome_pet || 'Pet',
          mensagem: `O tutor de "${petData.nome_pet || 'um pet'}" acessou seu contato referente ao avistamento`,
          data: new Date().toISOString(),
          lida: false,
          destinatario_uid: sightingData.owner_uid || '',
          destinatario_firebase_uid: sightingData.owner_firebase_uid || '',
          owner_firebase_uid: sightingData.owner_firebase_uid || ''
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
      logger.error('Erro ao buscar contato do avistador.', {
        error: error instanceof Error ? error.message : String(error),
        sightingId,
        petId
      });
      throw new HttpsError('internal', 'Erro ao buscar contato do avistador.');
    }
  }
);

/**
 * Auto-confirmação de reuniões (North Star).
 * Job diário: pets em 'aguardando_confirmacao' há mais de 7 dias são
 * confirmados automaticamente com reuniao.confirmacao_unilateral = true.
 * Custo: 1 execução/dia + reads apenas dos pendentes (baixíssimo).
 */
export const autoConfirmarReunioes = onSchedule(
  {
    schedule: 'every 24 hours',
    region: 'southamerica-east1',
    timeZone: 'America/Sao_Paulo',
  },
  async () => {
    const db = admin.firestore();
    const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
    const limite = Date.now() - SETE_DIAS_MS;

    const snap = await db
      .collection('pets_perdidos')
      .where('status', '==', 'aguardando_confirmacao')
      .limit(200)
      .get();

    let confirmados = 0;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const reuniao = data.reuniao || {};
      const marcadoEm = Date.parse(reuniao.marcado_em || '') || 0;
      if (!marcadoEm || marcadoEm > limite) continue; // ainda dentro da janela de 7 dias

      const agora = new Date().toISOString();
      const novaReuniao = {
        ...reuniao,
        confirmado_em: agora,
        confirmacao_unilateral: true,
      };
      try {
        await doc.ref.update({
          status: 'encontrado',
          desfecho: 'reuniao_confirmada',
          data_encerrado: agora,
          reuniao: novaReuniao,
        });
        await db.collection('lgpd_access_log').add({
          tipo: 'pet_encontrado',
          petId: doc.id,
          avistamentoId: reuniao.avistamento_id || '',
          bilateral: true,
          confirmacao_unilateral: true,
          timestamp: agora,
        });
        // Notifica o tutor sobre a confirmação automática.
        await db.collection('notificacoes').add({
          tipo: 'reuniao_confirmada',
          pet_perdido_id: doc.id,
          pet_nome: data.nome_pet || '',
          lida: false,
          destinatario_uid: reuniao.marcado_por_uid || data.owner_uid || '',
          destinatario_firebase_uid: reuniao.marcado_por_firebase_uid || data.owner_firebase_uid || '',
          confirmacao_unilateral: true,
          data: agora,
        });
        confirmados++;
      } catch (error) {
        logger.error('Falha ao auto-confirmar reunião.', {
          error: error instanceof Error ? error.message : String(error),
          petId: doc.id,
        });
      }
    }

    logger.info('autoConfirmarReunioes concluído.', {
      pendentesVarridos: snap.size,
      confirmados,
    });
  }
);
