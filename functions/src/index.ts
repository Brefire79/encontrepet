import { onObjectFinalized } from 'firebase-functions/v2/storage';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import sharp from 'sharp';

const blockhashCore = require('blockhash-core');

admin.initializeApp();

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
