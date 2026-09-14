# Resolv Tech // Visitas Operacionais — versão definitiva multiusuário

## O que esta versão entrega
- PostgreSQL como banco de dados central.
- Login seguro com bcrypt + JWT.
- Perfis Administrador e Consulta/Relatórios.
- Dashboard, Postos, Supervisores, Roteiros e Relatórios.
- Roteiro individual por supervisor.
- Visitas realizadas com data e histórico.
- Filtros dinâmicos.
- PDF pelo recurso de impressão do navegador.
- Interface responsiva para computador e celular.
- API REST pronta para hospedagem.

## Acesso inicial
admin / admin

Altere a senha do administrador antes de uso real.

## Publicação
1. Crie um PostgreSQL (por exemplo, Supabase, Neon, Render ou outro provedor).
2. Configure DATABASE_URL e JWT_SECRET.
3. Instale Node.js 20+.
4. Execute `npm install`.
5. Execute `npm start`.
6. Aponte um domínio/subdomínio para o serviço.

## Importante
Este pacote é o código da aplicação. O link público HTTPS não pode ser criado sem uma conta/serviço de hospedagem externo. Depois de publicado, todos os usuários acessam o mesmo banco de dados.


## Atualização visual e operacional
Esta versão inclui visualização completa do Dashboard com troca automática de supervisores a cada 10 segundos, gerenciamento persistente de Regionais, associação de usuário de acesso aos supervisores, roteiro em formato de supervisores expansíveis com ações de editar/excluir/adicionar visitas, relatório agrupado por supervisor com detalhamento por `+` e logotipo incorporado na impressão/PDF.


## Acesso MASTER
Usuário inicial: `admin`
Senha inicial: `admin`

O servidor garante o usuário MASTER na inicialização para evitar falhas no primeiro acesso. Depois do primeiro acesso em produção, troque a senha.
