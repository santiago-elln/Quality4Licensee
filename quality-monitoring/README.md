# iGreen Performance — Monitorias de Qualidade

Sistema de registro e análise de monitorias qualitativas para avaliação de atendimentos.

---

## Pré-requisitos

- Conta no [Supabase](https://supabase.com) com projeto criado
- Servidor HTTP local para desenvolvimento (ver abaixo)
- Navegador moderno com suporte a ES Modules

---

## Iniciando a aplicação localmente

Por usar ES Modules nativos, o projeto **não pode ser aberto diretamente via `file://`**. Use um servidor HTTP local:

**Opção 1 — VS Code (recomendado)**
Instale a extensão **Live Server** e clique em "Go Live" no canto inferior direito.

**Opção 2 — Node.js**
```bash
npx serve .
```

**Opção 3 — Python**
```bash
python -m http.server 5500
```

Após iniciar, acesse `http://localhost:5500`.

---

## Configuração do Supabase

### 1. Variáveis de ambiente

Edite o arquivo `js/config.js` e preencha com os dados do seu projeto Supabase:

```js
export const SUPABASE_URL  = 'https://SEU-PROJETO.supabase.co';
export const SUPABASE_ANON_KEY = 'sua-anon-key-aqui';
```

Ambas as chaves estão disponíveis em:
**Supabase Dashboard → Project Settings → API**

### 2. Segurança — Row Level Security (RLS)

Ative o RLS em todas as tabelas antes de ir para produção. Exemplos de políticas recomendadas:

```sql
-- Colaboradores só veem a si mesmos
CREATE POLICY "collab_self" ON monitorias
  FOR SELECT USING (colaborador_id = auth.uid());

-- Supervisores veem sua equipe
CREATE POLICY "supervisor_team" ON monitorias
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM equipes e
      WHERE e.supervisor_id = auth.uid()
        AND e.id = monitorias.equipe_id
    )
  );
```

### 3. Schema do banco de dados

Execute as migrations em `supabase/migrations/` (a criar na próxima fase) ou aplique manualmente via SQL Editor no Supabase Dashboard.

---

## Estrutura de pastas

```
quality-monitoring/
├── index.html               ← SPA shell (núcleo da aplicação)
├── README.md
├── assets/
│   └── images/              ← Logos e ícones
├── css/
│   ├── main.css             ← Importa todos os demais CSS
│   ├── variables.css        ← Design tokens (cores, fontes, espaçamentos)
│   ├── base.css             ← Reset e tipografia global
│   ├── layout.css           ← App shell, sidebar, header
│   ├── components/          ← Componentes reutilizáveis
│   │   ├── buttons.css
│   │   ├── cards.css
│   │   ├── forms.css
│   │   ├── tables.css
│   │   ├── modals.css
│   │   ├── badges.css
│   │   └── charts.css
│   └── pages/               ← Estilos específicos por página
│       ├── auth.css
│       ├── dashboard.css
│       ├── monitoring.css
│       ├── profile.css
│       └── admin.css
├── js/
│   ├── app.js               ← Entry point, bootstrap da SPA
│   ├── config.js            ← Configuração Supabase (editar antes de usar)
│   ├── auth.js              ← Estado de autenticação
│   ├── router.js            ← Roteamento hash-based
│   ├── data/
│   │   └── mock.js          ← Dados de demonstração (substituir por Supabase)
│   ├── utils/
│   │   ├── access.js        ← Controle de acesso por nível
│   │   └── formatters.js    ← Formatadores de data, tempo e números
│   ├── components/
│   │   ├── sidebar.js       ← Sidebar de navegação
│   │   ├── header.js        ← Header da aplicação
│   │   ├── charts.js        ← Wrappers de gráficos (Chart.js)
│   │   └── toast.js         ← Notificações toast
│   └── pages/
│       ├── login.js         ← Página de login
│       ├── dashboard.js     ← Painel principal de métricas
│       ├── nova-monitoria.js← Formulário de nova monitoria
│       ├── colaboradores.js ← Grid de colaboradores
│       ├── perfil.js        ← Perfil individual do colaborador
│       ├── registros.js     ← Histórico de monitorias
│       ├── ai-analise.js    ← Insights gerados por IA (Claude)
│       └── admin.js         ← Administração de usuários e equipes
```

---

## Níveis de acesso

| Nível | Role           | Visualização                        |
|-------|----------------|-------------------------------------|
| 6     | admin          | Sistema completo                    |
| 5     | coordenador    | Todo o departamento                 |
| 5     | gestor         | Todo o departamento                 |
| 4     | analista       | Todas as equipes do departamento    |
| 3     | supervisor     | Própria equipe                      |
| 2     | colaborador    | Apenas as próprias informações      |

As métricas possuem a propriedade `min_visible_accessLvl` definida em `js/utils/access.js`.
Somente usuários com nível ≥ ao configurado conseguem visualizar aquele dado para outros colaboradores.

---

## Usuários de demonstração

| Email                        | Senha   | Role        |
|------------------------------|---------|-------------|
| nathalia@igreen.com          | demo123 | coordenador |
| matheus@igreen.com           | demo123 | gestor      |
| ellian@igreen.com            | demo123 | analista    |
| annacara@igreen.com          | demo123 | supervisor  |
| colaborador1@igreen.com      | demo123 | colaborador |

---

## Deploy no GitHub Pages

1. Faça push do projeto para um repositório público
2. Vá em **Settings → Pages → Source: Deploy from branch → main / root**
3. O site estará disponível em `https://SEU-USUARIO.github.io/REPO/`

> **Atenção:** Nunca comite as chaves do Supabase diretamente no repositório público.
> Para produção, use GitHub Secrets + um pipeline de build para injetar variáveis.

---

## Próximas fases

- [ ] Integração real com Supabase Auth
- [ ] Integração com tabelas do banco de dados
- [ ] Integração com API da Claude para análises de IA
- [ ] Importação de métricas de plataformas externas de atendimento
- [ ] Exportação de relatórios em PDF/Excel
