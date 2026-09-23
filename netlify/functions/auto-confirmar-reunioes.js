// auto-confirmar-reunioes — Scheduled Function (cron diário no netlify.toml).
// Port da CF autoConfirmarReunioes: pets em 'aguardando_confirmacao' há mais
// de 7 dias são confirmados automaticamente (confirmacao_unilateral = true).
// North Star: reuniões confirmadas.

const { getAdmin } = require('./_lib/firebase');

exports.handler = async () => {
  const db = getAdmin().firestore();
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
    if (!marcadoEm || marcadoEm > limite) continue; // ainda dentro da janela

    const agora = new Date().toISOString();
    const novaReuniao = { ...reuniao, confirmado_em: agora, confirmacao_unilateral: true };
    try {
      await doc.ref.update({
        status: 'encontrado',
        desfecho: 'reuniao_confirmada',
        data_encerrado: agora,
        reuniao: novaReuniao
      });
      await db.collection('lgpd_access_log').add({
        tipo: 'pet_encontrado',
        petId: doc.id,
        avistamentoId: reuniao.avistamento_id || '',
        bilateral: true,
        confirmacao_unilateral: true,
        timestamp: agora
      });
      await db.collection('notificacoes').add({
        tipo: 'reuniao_confirmada',
        pet_perdido_id: doc.id,
        pet_nome: data.nome_pet || '',
        lida: false,
        destinatario_uid: reuniao.marcado_por_uid || data.owner_uid || '',
        destinatario_firebase_uid: reuniao.marcado_por_firebase_uid || data.owner_firebase_uid || '',
        confirmacao_unilateral: true,
        data: agora
      });
      confirmados++;
    } catch (error) {
      console.error('[auto-confirmar] falha em', doc.id, error.message);
    }
  }

  console.log(`[auto-confirmar] pendentes=${snap.size} confirmados=${confirmados}`);
  return { statusCode: 200, body: JSON.stringify({ pendentes: snap.size, confirmados }) };
};
