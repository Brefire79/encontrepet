# EncontrePet Functions

Cloud Functions para processamento server-side de imagens de alertas.

## Função incluída

- `generateImageHash` (Storage `onFinalize`)
  - Escuta uploads em `alerts/{alertId}/original.jpg`
  - Executa na região `southamerica-east1` (menor latência para Brasil)
  - Ignora não-imagem e caminhos derivados (`/derived/`, `/thumbnails/`, `thumb_*`)
  - Normaliza imagem com `sharp` (`resize 256x256` + `grayscale`)
  - Gera hash perceptual com `blockhash-core` (`blockhash16`)
  - Atualiza documento do alerta no Firestore (`pets_perdidos` ou `avistamentos`) com:
    - `imageHash`
    - `imageHashAlgo = "blockhash16"`
    - `imageHashVersion = 1`
    - `imageHashCreatedAt`
    - `imageHashProcessed = true`

## Pré-requisitos

- Node.js 20+
- Firebase CLI (`npm i -g firebase-tools`)
- Projeto Firebase com Firestore + Storage habilitados

## Setup inicial

No diretório raiz do projeto:

```bash
firebase login
firebase init functions
```

Quando perguntar o source das functions, use a pasta `functions` (já preparada neste repositório).

Depois instale dependências:

```bash
cd functions
npm install
```

## Build e deploy

```bash
npm run build
firebase deploy --only functions
```

Ou com script local da pasta `functions`:

```bash
npm run deploy
```

## Convenção de upload esperada

Para acionar a função com associação correta ao alerta, envie imagem para algo como:

- `alerts/{alertId}/original.jpg`
- `alerts/{alertId}/camera-001.jpg`

Opcionalmente, adicione metadata no upload:

- `collection: pets_perdidos` ou `avistamentos`

Se não houver metadata, a função tenta localizar o `alertId` nas duas coleções.

## Observações de robustez

- A função faz logs detalhados com `logger.info/warn/error`.
- Erros são tratados para não quebrar deploy nem execução da função.
- O client continua com fallback de hash local quando necessário.
