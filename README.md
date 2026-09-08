# Bot Moderador para Telegram com Painel Web

Bot avançado de moderação automática para grupos do Telegram com painel administrativo web em tempo real.

## 🚀 Funcionalidades

- 🚫 **Banimento por Palavras-Chave**: Se algum membro enviar uma palavra proibida configurada no painel, ele é imediatamente banido e **todas as suas mensagens/posts no grupo são apagados** (`revoke_messages: true`).
- 🚨 **Denúncia de Conteúdo Ilícito via Resposta**: Qualquer usuário pode responder a uma mensagem ou mídia ilícita digitando `/denuncia`, `/report` ou `/ilicito`. O bot imediatamente **bane o autor infrator, apaga a mídia denunciada e exclui todo o histórico de posts dele** no grupo.
- 🔇 **Anti-Link (Silenciamento Automático)**: Se alguém enviar links (`http://`, `https://`, `t.me`, etc.), a mensagem é deletada e o usuário é silenciado (mute) pelo período configurado.
- 🛡️ **Proteção de Administradores**: Administradores do grupo não são punidos acidentalmente.
- 📊 **Painel Web Administrativo**:
  - Adição e remoção dinâmica de palavras-chave proibidas.
  - Ativação/desativação do Anti-Link com tempo de mute ajustável (ex: 15m, 1h, 24h ou permanente).
  - Ativação e configuração do comando de denúncia de conteúdo ilícito.
  - Histórico de auditoria com detalhes da infração (incluindo quem denunciou).
  - Botão de **Desbanir** e **Desmutar** direto pelo painel web.
  - Status de conexão e estatísticas em tempo real.

---

## 🛠️ Instalação e Configuração

### 1. Requisitos
- [Node.js](https://nodejs.org/) versão 18 ou superior.
- Bot criado no Telegram via [@BotFather](https://t.me/BotFather).

### 2. Configurar Variáveis de Ambiente
Copie o arquivo de exemplo e insira seu token:
```bash
cp .env.example .env
```
Edite o arquivo `.env`:
```env
BOT_TOKEN=seu_token_do_bot_father_aqui
PORT=3000
```

### 3. Instalar Dependências
```bash
npm install
```

### 4. Iniciar a Aplicação

#### Opção A: Executar Diretamente (Node.js)
```bash
npm start
```
Para modo de desenvolvimento com reload automático:
```bash
npm run dev
```

#### Opção B: Executar via Docker Compose 🐳
Com o Docker instalado, basta rodar:
```bash
docker compose up -d --build
```
Para visualizar os logs:
```bash
docker compose logs -f
```
Para parar:
```bash
docker compose down
```

Abra o painel no navegador: **`http://localhost:3000`**

---

## ⚙️ Permissões Necessárias no Telegram

Para que a moderação automática funcione com sucesso:
1. Adicione o bot ao seu grupo/supergrupo.
2. Promova o bot a **Administrador**.
3. Conceda as permissões:
   - ✅ **Excluir mensagens** (`can_delete_messages`)
   - ✅ **Banir usuários** (`can_restrict_members`)
