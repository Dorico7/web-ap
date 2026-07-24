# Tutorial de Configuração do Supabase

Siga estes passos para configurar o backend do seu sistema financeiro.

## 1. Criar o Projeto
- Acesse [supabase.com](https://supabase.com/) e faça login.
- Clique em **New Project**.
- Escolha um nome, senha para o banco e a região mais próxima (ex: São Paulo - sa-east-1).

## 2. Configurar o Banco de Dados
- No menu lateral, clique em **SQL Editor**.
- Clique em **New Query**.
- Copie o conteúdo do arquivo `js/database/migrations.sql` do projeto e cole no editor.
- Clique em **Run**. Isso criará todas as tabelas, políticas de segurança e triggers necessárias.

## 3. Habilitar Realtime
- Vá em **Database > Replication**.
- Clique em **18 tables** (ou o número de tabelas que aparecer) em "Source".
- Habilite o Realtime para as tabelas `entries`, `driver_rates` e `settings`.

## 4. Configurar Autenticação
- Vá em **Authentication > Providers**.
- Certifique-se de que **Email** está habilitado.
- (Opcional) Desabilite "Confirm Email" se quiser que os usuários acessem imediatamente após o cadastro sem validar o e-mail.

## 5. Conectar o Frontend
- Vá em **Project Settings > API**.
- Copie a `Project URL` e a `API Key (anon/public)`.
- Crie o arquivo `env.js` na raiz do projeto:
  ```javascript
  window.env = {
    SUPABASE_URL: 'https://xyz.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1...'
  };
  ```
- Adicione o `env.js` no seu `index.html` antes do `app.js`:
  ```html
  <script src="./env.js"></script>
  ```

## 6. Módulo Motoboys (opcional)
- Execute também `js/database/motoboys_module.sql` (cria as tabelas do módulo, caso ainda não tenham sido criadas).
- Em seguida execute `js/database/motoboys_module_v2_migration.sql` — adiciona uma trava de segurança contra lançamentos duplicados na nova tela de Lançamentos (um lançamento por empresa/dia/motoboy/marketplace). É seguro rodar mesmo se o módulo já estiver em uso: não apaga lançamentos, apenas remove duplicidades antigas (mantendo o mais recente) antes de criar a trava.
- Por fim execute `js/database/motoboy_adiantamentos_migration.sql` — cria a tabela de **Adiantamentos (Vales)** dos motoboys, usada na nova aba "Adiantamentos" e no cálculo de Pagamento Líquido do Fechamento. Também aditiva e segura de rodar mais de uma vez.
- E, por último, execute `js/database/adiantamentos_generic_migration.sql` — generaliza os Adiantamentos para um modelo único (`tipo_pessoa` + `pessoa_id`), passando a suportar também **Motoristas**. Migra automaticamente os dados existentes, mantém `motoboy_adiantamentos` funcionando como antes (agora como uma view de compatibilidade) e é transacional/idempotente: pode ser executada mais de uma vez sem duplicar dados.
