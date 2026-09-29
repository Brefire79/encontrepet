# PRD — Encontre Pet v2.0

> **Produto:** Encontre Pet — PWA comunitário da **Vianexx AI**
> **URL:** https://encontre-pet.netlify.app/
> **Documento:** Product Requirements (refletindo o estado **real** do app, não o planejado antigo)
> **Atualizado:** 2026-06-12

---

## Problema

Quando um pet se perde, o tutor não tem um canal centralizado e gratuito para alertar quem está por perto e cruzar avistamentos. As alternativas hoje são grupos de WhatsApp e posts em redes sociais — dispersos, sem geolocalização e sem qualquer comparação de imagem. O resultado é busca lenta, alcance limitado e reencontros que dependem de sorte.

## Objetivos (mensuráveis)

1. **North Star:** aumentar **reuniões confirmadas** (pet + tutor) mês a mês.
2. **Custo:** manter o **custo Firebase ≤ R$ 0 líquido** após patrocínios (operar dentro das cotas free-tier Blaze).
3. **Velocidade de alerta:** reduzir o **tempo médio entre alerta e primeiro avistamento**.
4. **Engajamento de comunidade:** aumentar a média de **avistamentos por alerta**.
5. **Qualidade do match:** manter taxa saudável de matches sugeridos (score ≥ 70%) que evoluem para contato.

## Não-objetivos (com justificativa)

- **Monetizar o usuário final.** O app é gratuito por missão; receita só via patrocínio para cobrir custos.
- **Virar rede social pet.** Feed, perfis e curtidas sociais diluiriam o foco na busca e aumentariam custo/Firestore.
- **App de adoção.** Escopo é reencontro de perdidos/avistados; adoção é outro problema e outro fluxo.
- **Backend pesado / dependência de serviço pago.** Decisão arquitetural: client-side primeiro, minimizar reads/escritas e invocações de Functions.

## Personas e user stories

### Tutor (perdeu o pet)
- Como tutor, quero **disparar um alerta em segundos** (foto + tipo + local) para avisar quem está perto.
- Quero **completar o cadastro depois**, sem travar o alerta inicial.
- Quero **controlar a exposição do meu contato** (telefone/e-mail opt-in) e saber que meus dados privados ficam protegidos (LGPD).
- Quero **ser notificado** quando alguém avista um animal parecido com o meu.
- Quero **encerrar o alerta** registrando o desfecho (encontrado vivo, falecido, desistência).
- *Erro/vazio:* sem alertas/avistamentos ainda → estado vazio explicando como ativar localização.

### Avistador (viu um pet)
- Como avistador, quero **tirar uma foto** e deixar a IA comparar com os pets reportados.
- Quero **avisar o tutor** mesmo quando o match não é forte.
- Quero **conversar pelo chat interno** ou WhatsApp sem expor meu número se eu não quiser.
- *Erro/vazio:* nenhum pet para comparar → mensagem orientando a enviar o avistamento mesmo assim.

### Patrocinador (Bronze/Prata/Ouro)
- Como patrocinador, quero **cobrir parte dos custos** e ter reconhecimento, entendendo que isso mantém o app gratuito.
- *Erro/vazio:* sem patrocinadores → seção explica o modelo e como apoiar.

### Admin
- Como admin, quero um **painel** com métricas (usuários, pets, avistamentos, encontrados, taxa de sucesso, bloqueados).
- Quero **detectar duplicatas/fraude** (hash de imagem + distância geográfica) e moderar casos suspeitos.
- *Erro/vazio:* acesso negado para não-admin (documento `admin_roles` criado manualmente).

## Requisitos

### P0 (essenciais — já em produção)
- **R-P0-1 Reporte rápido.** *Dado* tutor com foto e local, *quando* dispara o alerta, *então* o pet vira documento público e os dados sensíveis vão para `alert_privado`.
- **R-P0-2 Avistamento com matching IA.** *Dado* uma foto de avistamento, *quando* enviada, *então* a IA (client-side) compara e sugere candidatos com score ≥ 70%.
- **R-P0-3 Privacidade de contato.** *Dado* um não-dono, *quando* solicita contato do tutor, *então* o acesso passa **obrigatoriamente** pela Cloud Function `getTutorContact` com log LGPD.
- **R-P0-4 Localização ofuscada.** *Dado* qualquer alerta público, *quando* exibido a terceiros, *então* a posição aparece aproximada (nunca o endereço exato).

### P1 (importantes — em produção, com melhorias previstas)
- **R-P1-1 Chat interno** entre tutor e avistador em matches.
- **R-P1-2 Notificações** de match e de acesso a contato.
- **R-P1-3 Encerramento com desfecho** e pesquisa pós-reunião.
- **R-P1-4 i18n PT/EN/ES** com paridade total para toda string nova.

### P2 (evolução)
- **R-P2-1 Confirmação bilateral de reunião.** *Dado* um match vinculado, *quando* o tutor marca "reunido", *então* a contraparte recebe pedido de confirmação; *com* as duas confirmações *então* status vira `reuniao_confirmada` (timeout de 7 dias auto-confirma com flag). Pets sem match seguem unilaterais.
- **R-P2-2 Otimização de custo Firestore** (cache TTL, paginação, menos listeners).
- **R-P2-3 Dashboard LGPD para o tutor** (quem acessou seu contato e quando).

## Métricas de sucesso

- **North Star:** reuniões confirmadas (bilaterais).
- **Leading:** alertas criados, avistamentos por alerta, taxa de match ≥ 70%, tempo até primeiro avistamento.
- **Lagging:** retenção de tutores, NPS pós-reunião (pesquisa já existente).
- **Operacional:** reads/escritas Firestore por dia e invocações de Functions (manter dentro do free-tier).

## Questões em aberto

| Questão | Responsável |
|---|---|
| Padronizar identidade do destinatário (1 campo vs 2) para reduzir listeners | Breno |
| Redesenho das rules de ownership para destravar S-08 (sem quebrar dono) | Breno + Claude |
| Como medir "pessoas alcançadas" sem custo extra de reads | Breno |

## Roadmap (estado real)

- **Concluído:** reporte rápido, avistamento + matching IA client-side, chat interno, painel admin + detector de duplicatas, revelação de contato via CF com LGPD, hardening de segurança (S-01..S-07, S-09, S-10, S-11), i18n PT/EN/ES.
- **Agora:** Fase 2 — confirmação bilateral de reunião (North Star) + otimização de custo Firestore.
- **Próximo:** destravar S-08 (rules + migração), dashboard LGPD do tutor, notificação ao tutor em acesso de contato.

---

*Encontre Pet — feito pela comunidade, grátis para sempre para o usuário final.*
