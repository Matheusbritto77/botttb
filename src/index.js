import dotenv from 'dotenv';
dotenv.config();

import { createServer } from './server.js';
import { BotManager } from './bot.js';

const PORT = process.env.PORT || 3000;

async function main() {
  const app = createServer();

  app.listen(PORT, async () => {
    console.log('====================================================');
    console.log(`🚀 Painel Web disponível em: http://localhost:${PORT}`);
    console.log('====================================================');

    // Tenta iniciar o bot com o token disponível
    const token = process.env.BOT_TOKEN;
    if (token && token.trim()) {
      console.log('[Sistema] Inicializando bot do Telegram...');
      const res = await BotManager.start(token);
      if (res.success) {
        console.log(`[Sistema] Bot online como @${res.botInfo.username}`);
      } else {
        console.warn(`[Sistema] Aviso: Bot não pôde ser iniciado: ${res.error}`);
        console.warn(`[Sistema] Você pode configurar o token no Painel Web (http://localhost:${PORT})`);
      }
    } else {
      console.log('[Sistema] Nenhum BOT_TOKEN encontrado no arquivo .env.');
      console.log(`[Sistema] Acesse o Painel Web em http://localhost:${PORT} para inserir o Token.`);
    }
  });

  // Tratamento de encerramento gracioso
  const shutdown = async () => {
    console.log('\n[Sistema] Encerrando aplicação...');
    await BotManager.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[Sistema] Erro fatal na inicialização:', err);
  process.exit(1);
});
