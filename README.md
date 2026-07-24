# Financeiro GM FLEX - Versão Profissional (Supabase)

Este projeto é uma evolução do sistema financeiro PWA original, agora integrado ao **Supabase** para fornecer persistência em nuvem, autenticação segura e sincronização em tempo real entre múltiplos usuários da mesma empresa.

## 🚀 Funcionalidades

- **PWA (Progressive Web App)**: Instalável e funciona offline.
- **Autenticação Segura**: Login por e-mail e senha via Supabase Auth.
- **Multi-tenancy**: Dados isolados por empresa (company_id).
- **Sincronização em Tempo Real**: Alterações refletidas instantaneamente para todos os usuários da empresa.
- **Migração Automática**: Dados do `localStorage` são migrados para o PostgreSQL no primeiro login.
- **Segurança RLS**: Row Level Security garantindo que usuários só acessem dados de sua própria empresa.

## 🛠️ Configuração do Supabase

1. Crie um projeto no [Supabase](https://supabase.com/).
2. No Editor SQL do Supabase, execute o conteúdo do arquivo `js/database/migrations.sql`.
3. Vá em **Project Settings > API** e obtenha a `URL` e a `anon key`.
4. Crie um arquivo chamado `env.js` na raiz do projeto (ou configure via variáveis de ambiente se estiver usando um bundler) com o seguinte conteúdo:
   ```javascript
   window.env = {
     SUPABASE_URL: 'SUA_URL_AQUI',
     SUPABASE_ANON_KEY: 'SUA_ANON_KEY_AQUI'
   };
   ```

## 📦 Instalação e Deploy

### Localmente
Basta abrir o arquivo `index.html` em um servidor local (ex: Live Server do VS Code).

### GitHub Pages
1. Faça o push do código para o seu repositório.
2. Vá em **Settings > Pages** e ative a publicação a partir da branch principal.
3. Certifique-se de configurar o arquivo `env.js` corretamente no seu ambiente de deploy.

## 🔒 Segurança

O sistema utiliza **Row Level Security (RLS)** no PostgreSQL. Isso significa que, mesmo que alguém obtenha a chave anônima, não poderá ler ou escrever dados que não pertençam à sua empresa vinculada no Supabase.

## 📄 Licença
Propriedade de Guilherme Marques - GM FLEX.
