// process-avistamento — substituto do trigger onAvistamentoCreated.
// O cliente chama logo após criar o doc (db.js reportarAvistamento, com retry).
// Idempotente: claim transacional no campo `processado` (ver _lib/avistamento-core.js).
// Aceita auth anônimo (mesma semântica do trigger, que rodava para qualquer create
// permitido pelas rules). Nada do payload é confiado — tudo é lido do Firestore.

const { callable, HttpsError, checkRateLimit } = require('./_lib/http');
const { processAvistamento } = require('./_lib/avistamento-core');

exports.handler = callable(async ({ data, auth }) => {
  const { avistamentoId } = data;
  if (!avistamentoId || typeof avistamentoId !== 'string' || avistamentoId.length > 64) {
    throw new HttpsError('invalid-argument', 'avistamentoId é obrigatório.');
  }
  // Mesmo limite do rate-limit client-side de criação de avistamentos.
  checkRateLimit('process-avist', auth.uid, 10, 300_000);

  const result = await processAvistamento(avistamentoId);
  if (result.status === 'nao_encontrado') {
    throw new HttpsError('not-found', 'Avistamento não encontrado.');
  }
  return result;
});
