# Oria Platform

Aplicação principal da Oria, uma secretária com IA voltada inicialmente para
agendamentos e acompanhamentos de clientes pelo WhatsApp.

## Estado atual

- Login com credenciais e sessão protegida via NextAuth
- Usuários persistidos no MongoDB
- Dashboard autenticado com o estado real do MVP
- Perfil carregado da sessão no servidor
- Integração demonstrativa com a WhatsApp Cloud API
- Envio de template e histórico local de mensagens no MongoDB
- Webhook para mensagens recebidas e atualizações de status

Agenda e acompanhamentos ainda não possuem persistência nem APIs. Consulte
[MVP.md](MVP.md) para o escopo proposto.

## Desenvolvimento

Copie as chaves de `.env.example` para `.env.local` e preencha os valores.
Depois:

```bash
npm install
npm run seed
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## WhatsApp Business

A demonstração usa uma configuração única no servidor. Preencha estas
variáveis em `.env.local`:

- `WHATSAPP_PHONE_NUMBER_ID`: ID do número fornecido pela Meta
- `WHATSAPP_ACCESS_TOKEN`: token de acesso, somente no servidor
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: segredo escolhido para validar o webhook
- `WHATSAPP_APP_SECRET`: segredo do aplicativo para validar assinaturas
- `WHATSAPP_BUSINESS_ACCOUNT_ID`: opcional nesta primeira versão

No painel da Meta, configure o callback com a URL exibida na página
`/dashboard/whatsapp`, use o mesmo token de verificação e assine o campo
`messages`. Em desenvolvimento, o callback precisa ser publicado por uma URL
HTTPS; `localhost` não pode ser acessado pela Meta.

A Cloud API não fornece importação retroativa de conversas. O endpoint
`GET /api/whatsapp/messages` consulta somente o histórico armazenado pela Oria
desde a ativação do webhook. Nesta demonstração, a configuração e o histórico
são compartilhados por todos os usuários autenticados; isolamento por empresa
deve ser implementado antes de uso multi-tenant.

Nunca coloque o token da Meta no código ou em uma variável `NEXT_PUBLIC_*`.

## Verificação

```bash
npm run lint
npm run build
```
