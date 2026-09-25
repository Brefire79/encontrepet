// _lib/push.js — notificação push (Firebase Cloud Messaging, gratuito no Spark).
// Os tokens dos aparelhos ficam em push_tokens/{sha256(token)}, gravados só
// pelo endpoint push-token (as rules negam o cliente: coleção não listada).
//
// Envio sempre "best effort": nunca lança — a notificação in-app (coleção
// notificacoes) continua sendo a fonte da verdade; o push só avisa o aparelho.
// LGPD: o texto aparece na tela bloqueada, então leva no máximo o nome do pet
// — nunca telefone, e-mail ou endereço.

const { getAdmin } = require('./firebase');

const APP_URL = 'https://encontre-pet.netlify.app/';

const TEXTOS = {
  pt: {
    match_alto_para_tutor: ['Alguém pode ter visto {pet}!', 'Um avistamento parecido com {pet} foi registrado. Abra o app para ver e conversar.'],
    avistamento_registrado: ['Novo avistamento de {pet}', 'Alguém registrou um avistamento ligado a {pet}. Abra o app para ver.'],
    match_ia: ['Avistamento perto de onde {pet} sumiu', 'Um animal foi visto perto do local de perda. Confira se é {pet}.'],
    match_alto_para_avistador: ['Seu avistamento pode ser {pet}', 'O tutor foi avisado. Vocês podem conversar pelo chat do app.'],
    avistamento_contato: ['Alguém quer falar sobre {pet}', 'Uma pessoa que viu {pet} deixou um contato. Abra o app para ver.'],
    reuniao_confirmada: ['Reencontro de {pet} confirmado', 'Obrigado por usar o Encontre Pet!'],
    padrao: ['Encontre Pet', 'Você tem uma nova notificação.']
  },
  en: {
    match_alto_para_tutor: ['Someone may have seen {pet}!', 'A sighting similar to {pet} was logged. Open the app to see it and chat.'],
    avistamento_registrado: ['New sighting of {pet}', 'Someone logged a sighting linked to {pet}. Open the app to see it.'],
    match_ia: ['Sighting near where {pet} went missing', 'An animal was seen near the place it was lost. Check if it is {pet}.'],
    match_alto_para_avistador: ['Your sighting may be {pet}', 'The owner was notified. You can chat in the app.'],
    avistamento_contato: ['Someone wants to talk about {pet}', 'A person who saw {pet} left a contact. Open the app to see it.'],
    reuniao_confirmada: ['{pet}’s reunion confirmed', 'Thank you for using Encontre Pet!'],
    padrao: ['Encontre Pet', 'You have a new notification.']
  },
  es: {
    match_alto_para_tutor: ['¡Alguien pudo haber visto a {pet}!', 'Se registró un avistamiento parecido a {pet}. Abre la app para verlo y conversar.'],
    avistamento_registrado: ['Nuevo avistamiento de {pet}', 'Alguien registró un avistamiento vinculado a {pet}. Abre la app para verlo.'],
    match_ia: ['Avistamiento cerca de donde se perdió {pet}', 'Vieron un animal cerca del lugar de la pérdida. Revisa si es {pet}.'],
    match_alto_para_avistador: ['Tu avistamiento puede ser {pet}', 'Se avisó al dueño. Pueden conversar por el chat de la app.'],
    avistamento_contato: ['Alguien quiere hablar de {pet}', 'Una persona que vio a {pet} dejó un contacto. Abre la app para verlo.'],
    reuniao_confirmada: ['Reencuentro de {pet} confirmado', '¡Gracias por usar Encontre Pet!'],
    padrao: ['Encontre Pet', 'Tienes una nueva notificación.']
  }
};

const PET_PADRAO = { pt: 'seu pet', en: 'your pet', es: 'tu mascota' };

function montarTexto(lang, tipo, petNome) {
  const l = TEXTOS[lang] ? lang : 'pt';
  const [t, b] = TEXTOS[l][tipo] || TEXTOS[l].padrao;
  const pet = String(petNome || '').slice(0, 40) || PET_PADRAO[l];
  return { title: t.replace('{pet}', pet), body: b.replace('{pet}', pet) };
}

async function tokensDoDestinatario(db, firebaseUid, ownerUid) {
  const docs = new Map();
  if (firebaseUid) {
    (await db.collection('push_tokens').where('owner_firebase_uid', '==', firebaseUid).limit(10).get())
      .forEach(d => docs.set(d.id, d));
  }
  // owner_uid só é gravado quando o endpoint confirmou o vínculo com a conta
  // (nunca anon_xxx), então buscar por ele é seguro e cobre outros aparelhos.
  if (ownerUid && !String(ownerUid).startsWith('anon_')) {
    (await db.collection('push_tokens').where('owner_uid', '==', ownerUid).limit(10).get())
      .forEach(d => docs.set(d.id, d));
  }
  return [...docs.values()];
}

const TOKEN_INVALIDO = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

/**
 * Envia push para todos os aparelhos do destinatário. Nunca lança.
 * @param {{firebaseUid?:string, ownerUid?:string}} dest
 * @param {{tipo:string, petNome?:string, tag?:string}} msg
 */
async function enviarPush(dest, msg) {
  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const docs = await tokensDoDestinatario(db, dest.firebaseUid || '', dest.ownerUid || '');
    if (docs.length === 0) return 0;

    const mensagens = docs.map(d => {
      const { token, lang } = d.data();
      const { title, body } = montarTexto(lang, msg.tipo, msg.petNome);
      return {
        token,
        // data-only: o sw.js monta a notificação (controle do texto e do toque)
        webpush: {
          headers: { Urgency: 'high', TTL: '86400' },
          data: { title, body, link: `${APP_URL}#notificacoes`, tag: msg.tag || msg.tipo }
        }
      };
    });

    const res = await admin.messaging().sendEach(mensagens);
    // Aparelho desinstalou / revogou: o token morreu — remove para não insistir.
    await Promise.all(res.responses.map((r, i) =>
      (!r.success && TOKEN_INVALIDO.has(r.error?.code)) ? docs[i].ref.delete().catch(() => {}) : null
    ));
    return res.successCount;
  } catch (err) {
    console.warn('[push] envio falhou (não-fatal):', err.message);
    return 0;
  }
}

module.exports = { enviarPush, montarTexto };
