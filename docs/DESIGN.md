# DESIGN.md — Encontre Pet

Referência visual do app. **Fonte de verdade: `css/style.css`** (variáveis em `:root`, linha ~7). Este arquivo só documenta as decisões; se divergir do CSS, vale o CSS.

## Princípios
- **Mobile-first** (PWA). Desktop é adaptação (`@media (min-width: 769px/1025px)`).
- **Sem framework de UI**: Vanilla JS + CSS único.
- **Acessível**: contraste mínimo WCAG AA (ex.: `--text-muted` no tema claro = `#687479`, 4,57:1 — v1.21.5).
- **Toda string visível passa por i18n** (`pt`/`en`/`es`), inclusive `aria-label` e `title`.

## Tokens (`:root`)
| Grupo | Variáveis |
|---|---|
| Marca | `--primary #FF6B35`, `--primary-dark`, `--primary-light`, `--secondary #4ECDC4`, `--accent #FFE66D` |
| Estado | `--danger #FF6B6B`, `--success #51CF66`, `--warning #FFA94D`, `--info #74C0FC` |
| Superfície | `--bg`, `--bg-card`, `--bg-dark`, `--border` |
| Texto | `--text`, `--text-light`, `--text-muted` |
| Forma | `--radius 16px`, `--radius-sm 10px`, `--radius-full 50px`, `--shadow`, `--shadow-lg` |
| Layout | `--header-height 60px`, `--bottom-nav-height 70px`, `--safe-top`, `--safe-bottom` (safe-area iOS) |

Tipografia: **Nunito** (fallback sistema).

## Temas
- Claro é o padrão. Escuro via `@media (prefers-color-scheme: dark)` **e** `[data-theme="dark"]` (override manual).
- Ao criar componente com cor fixa, adicionar o par `[data-theme="dark"]` (ver `.badge-manual`/`.badge-ia`).
- Nunca usar `#B2BEC3` como texto no claro (contraste 1,8:1).

## Breakpoints em uso
`≤360px`, `≤380px`, `361–414px`, `≥600px`, `≥768px`, `768–1024px`, `≥769px`, `≥1025px`, paisagem baixa (`max-height:500px`).

## Padrões de UI
- Navegação: header fixo + **bottom nav** (respeitar `--safe-bottom`).
- Cards de pet: foto (`foto_thumb`) + badge de status + distância; raio/threshold exibidos vêm de `AppConfig` (nunca fixos na UI).
- Matches: exibidos a partir de **70%** (gatilho único).
- Contato do tutor: nunca renderizado para não-dono sem passar por `getTutorContact` (LGPD).
- Feedback: toast para ações rápidas; modal para confirmação destrutiva; alarme sonoro só após 1º toque do usuário (política de autoplay).

## Checklist ao mexer em UI
- [ ] Testado em claro e escuro
- [ ] Testado em 360px e desktop
- [ ] Strings em pt/en/es
- [ ] Contraste AA
- [ ] Sem threshold/raio hardcoded
