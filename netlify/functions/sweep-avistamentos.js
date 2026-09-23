// sweep-avistamentos — Scheduled Function (cron no netlify.toml: a cada 6h).
// Rede de segurança do process-avistamento: reprocessa avistamentos das
// últimas 48h que ficaram sem processar (cliente fechou o app antes do retry,
// erro transitório, etc.). Idempotente via claim do avistamento-core.
// Custo: 4 execuções/dia + 1 query limit(100).

const { getAdmin } = require('./_lib/firebase');
const { processAvistamento } = require('./_lib/avistamento-core');

exports.handler = async () => {
  const db = getAdmin().firestore();
  const cutoffISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // data_avistamento é ISO string — range query lexicográfica, sem índice composto.
  const snap = await db.collection('avistamentos')
    .where('data_avistamento', '>=', cutoffISO)
    .limit(100)
    .get();

  const pendentes = snap.docs.filter(d => d.data().processado !== true);
  let ok = 0, falhas = 0;

  for (const doc of pendentes) {
    try {
      const r = await processAvistamento(doc.id);
      if (r.status === 'processado') ok++;
    } catch (err) {
      falhas++;
      console.error('[sweep] falha em', doc.id, err.message);
    }
  }

  console.log(`[sweep] varridos=${snap.size} pendentes=${pendentes.length} processados=${ok} falhas=${falhas}`);
  return { statusCode: 200, body: JSON.stringify({ varridos: snap.size, pendentes: pendentes.length, ok, falhas }) };
};
