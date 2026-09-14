# Resolv Tech // Visitas Operacionais — Publicação HTTPS

## Arquitetura
- Aplicação: Node.js/Express
- Banco: PostgreSQL
- Autenticação: JWT + bcrypt
- HTTPS: fornecido pela plataforma de hospedagem
- Deploy recomendado: Render + PostgreSQL (ou PostgreSQL compatível)

## Publicação
1. Suba este projeto para um repositório privado no GitHub.
2. Crie um banco PostgreSQL em um provedor compatível.
3. No Render, crie um Web Service apontando para o repositório.
4. O Render usará o `Dockerfile`.
5. Configure:
   - `DATABASE_URL` = URL do PostgreSQL
   - `JWT_SECRET` = uma chave longa e aleatória
   - `NODE_ENV` = `production`
6. O serviço deverá responder em `/api/health`.
7. Após o deploy, o Render fornecerá um endereço HTTPS `*.onrender.com`.

## Segurança
- Não coloque senhas ou `DATABASE_URL` dentro do GitHub.
- Troque a senha inicial `admin/admin` imediatamente após o primeiro acesso.
- Use uma senha forte para `JWT_SECRET`.


## Teste do login MASTER
Use:
- Usuário: `admin`
- Senha: `admin`

Para validar o banco após o deploy, acesse `/api/health`. O esperado é `ok=true` e `db=true`.
