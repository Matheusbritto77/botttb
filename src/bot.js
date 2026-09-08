import { Telegraf } from 'telegraf';
import { Storage } from './storage.js';

let botInstance = null;
let botInfo = null;
let isRunning = false;
let startError = null;

// Regex para detecção abrangente de links (ignora emails comuns com @)
const URL_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)|(telegram\.me\/[^\s]+)|((?<!@)\b[a-zA-Z0-9-]+\.(com|org|net|io|me|xyz|app|site|online|store|tech|info|co|cc|tv|br|ru|vip|top|club|link)\b([\/\w\.-]*))/i;

/**
 * Remove acentos e normaliza string para verificação de palavras-chave
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Verifica se a mensagem contém links
 */
function containsLink(ctx) {
  const message = ctx.message;
  if (!message) return false;

  // 1. Verificação por entidades nativas do Telegram
  const entities = message.entities || message.caption_entities || [];
  const hasUrlEntity = entities.some(e => e.type === 'url' || e.type === 'text_link');
  if (hasUrlEntity) return true;

  // 2. Verificação por regex no texto ou legenda
  const text = message.text || message.caption || '';
  return URL_REGEX.test(text);
}

/**
 * Verifica se a mensagem contém palavras-chave proibidas
 */
function checkForbiddenKeyword(text, keywords) {
  if (!text || !keywords || !keywords.length) return null;
  const normalizedMsg = normalizeText(text);

  for (const item of keywords) {
    const normKeyword = normalizeText(item.word);
    if (!normKeyword) continue;

    // Busca como palavra completa ou substring significativa
    const regex = new RegExp(`\\b${normKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(normalizedMsg) || normalizedMsg.includes(normKeyword)) {
      return item.word;
    }
  }
  return null;
}

/**
 * Verifica se o usuário é Administrador ou Criador do grupo
 */
async function isUserAdmin(ctx) {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    const member = await ctx.getChatMember(ctx.from.id);
    return member.status === 'administrator' || member.status === 'creator';
  } catch (err) {
    // Se falhar ao checar status, assume false por precaução
    return false;
  }
}

/**
 * Envia notificação temporária no chat e apaga após alguns segundos
 */
async function sendTempWarning(ctx, text, durationMs = 8000) {
  try {
    const settings = Storage.getSettings();
    if (!settings.notifyInChat) return;

    const msg = await ctx.reply(text, { parse_mode: 'HTML' });
    setTimeout(async () => {
      try {
        await ctx.deleteMessage(msg.message_id);
      } catch (_) {}
    }, durationMs);
  } catch (_) {}
}

/**
 * Configura os middlewares e tratadores de evento do bot
 */
function setupHandlers(bot) {
  bot.catch((err, ctx) => {
    console.error(`[Bot Error] Erro ao processar atualização para ${ctx?.updateType}:`, err.message);
  });

  // Log de boas-vindas ao ser adicionado a um grupo
  bot.on('new_chat_members', async (ctx) => {
    const isBotAdded = ctx.message.new_chat_members.some(m => m.id === bot.botInfo?.id);
    if (isBotAdded) {
      console.log(`[Bot] Adicionado ao chat: "${ctx.chat.title}" (${ctx.chat.id})`);
      await ctx.reply(
        '🛡️ <b>Bot de Moderação Ativo!</b>\n\n' +
        'Para que a proteção funcione perfeitamente, por favor me promova a <b>Administrador</b> com permissões para <i>Excluir mensagens</i> e <i>Banir usuários</i>.',
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  });

  // Monitor de mensagens de texto e mídia com legenda
  bot.on(['message', 'edited_message'], async (ctx) => {
    const message = ctx.message || ctx.edited_message;
    if (!message || !ctx.chat) return;

    // Apenas monitora grupos e supergrupos
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
      if (ctx.chat.type === 'private' && message.text === '/start') {
        return ctx.reply('👋 Olá! Sou o Bot de Moderação. Adicione-me a um grupo como Administrador para gerenciar palavras proibidas e links.');
      }
      return;
    }

    // Não monitora o próprio bot
    if (ctx.from.is_bot) return;

    Storage.incrementStat('totalMessagesChecked');

    // Administradores são isentos de restrições
    const admin = await isUserAdmin(ctx);
    if (admin) return;

    const text = message.text || message.caption || '';
    const keywords = Storage.getKeywords();
    const settings = Storage.getSettings();

    // 1. CHECAGEM DE PALAVRAS-CHAVE PROIBIDAS (PRIORIDADE ALTA: BAN + REVOKE POSTS)
    const matchedKeyword = checkForbiddenKeyword(text, keywords);
    if (matchedKeyword) {
      console.log(`[Moderação] Palavra proibida detectada: "${matchedKeyword}" enviada por ${ctx.from.first_name} (${ctx.from.id}) no chat ${ctx.chat.title}`);

      // Apaga a mensagem imediatamente
      await ctx.deleteMessage(message.message_id).catch(err => {
        console.warn('[Moderação] Não foi possível apagar a mensagem:', err.message);
      });

      // Aplica banimento com exclusão de todas as mensagens do usuário (revoke_messages: true)
      let banSuccess = false;
      try {
        await ctx.banChatMember(ctx.from.id, {
          revoke_messages: settings.deleteBannedUserPosts !== false
        });
        banSuccess = true;
      } catch (err) {
        console.error('[Moderação] Falha ao banir membro (verifique permissões de admin do bot):', err.message);
      }

      if (banSuccess) {
        Storage.incrementStat('totalBans');
        Storage.addLog({
          action: 'BAN',
          userId: ctx.from.id,
          userName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'Sem nome',
          userTag: ctx.from.username ? `@${ctx.from.username}` : '',
          chatId: ctx.chat.id,
          chatTitle: ctx.chat.title,
          reason: `Palavra proibida: "${matchedKeyword}"`,
          text: text
        });

        await sendTempWarning(
          ctx,
          `🚫 <b>Usuário Banido!</b>\n<b>Usuário:</b> ${ctx.from.first_name}\n<b>Motivo:</b> Uso de termo não permitido.\n<i>Todas as mensagens foram removidas.</i>`
        );
      }
      return; // Interrompe processamento
    }

    // 2. CHECAGEM DE ANTI-LINK (SILENCIAR / MUTE)
    if (settings.antiLink && containsLink(ctx)) {
      console.log(`[Moderação] Link detectado enviado por ${ctx.from.first_name} (${ctx.from.id}) no chat ${ctx.chat.title}`);

      // Apaga a mensagem contendo o link
      await ctx.deleteMessage(message.message_id).catch(err => {
        console.warn('[Moderação] Não foi possível apagar mensagem de link:', err.message);
      });

      // Calcula tempo de mute
      const durationMinutes = Number(settings.muteDurationMinutes) || 0;
      let untilDate = undefined;
      let durationDesc = 'Permanente';

      if (durationMinutes > 0) {
        untilDate = Math.floor(Date.now() / 1000) + (durationMinutes * 60);
        durationDesc = durationMinutes >= 60 
          ? `${Math.round(durationMinutes / 60)}h` 
          : `${durationMinutes}m`;
      }

      // Restringe permissões do usuário (Mute total de envio de mensagens)
      let muteSuccess = false;
      try {
        await ctx.restrictChatMember(ctx.from.id, {
          permissions: {
            can_send_messages: false,
            can_send_audios: false,
            can_send_documents: false,
            can_send_photos: false,
            can_send_videos: false,
            can_send_video_notes: false,
            can_send_voice_notes: false,
            can_send_polls: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false
          },
          until_date: untilDate
        });
        muteSuccess = true;
      } catch (err) {
        console.error('[Moderação] Falha ao silenciar membro (verifique permissões de admin do bot):', err.message);
      }

      if (muteSuccess) {
        Storage.incrementStat('totalMutes');
        Storage.addLog({
          action: 'MUTE',
          userId: ctx.from.id,
          userName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'Sem nome',
          userTag: ctx.from.username ? `@${ctx.from.username}` : '',
          chatId: ctx.chat.id,
          chatTitle: ctx.chat.title,
          reason: `Envio de link não autorizado (Silenciado por ${durationDesc})`,
          text: text
        });

        await sendTempWarning(
          ctx,
          `🔇 <b>Usuário Silenciado!</b>\n<b>Usuário:</b> ${ctx.from.first_name}\n<b>Motivo:</b> Envio de links proibido.\n<b>Duração:</b> ${durationDesc}.`
        );
      }
    }
  });
}

export const BotManager = {
  async start(token) {
    const activeToken = token || process.env.BOT_TOKEN || Storage.getSettings().botToken;

    if (!activeToken || activeToken.trim() === '') {
      isRunning = false;
      startError = 'Nenhum token configurado. Adicione o BOT_TOKEN no .env ou no Painel Web.';
      console.warn('[BotManager] ' + startError);
      return { success: false, error: startError };
    }

    try {
      if (botInstance && isRunning) {
        await this.stop();
      }

      console.log('[BotManager] Iniciando bot do Telegram...');
      const bot = new Telegraf(activeToken.trim());
      setupHandlers(bot);

      // Validação de conexão e obtenção das informações do bot
      const me = await bot.telegram.getMe();
      botInfo = me;
      botInstance = bot;
      isRunning = true;
      startError = null;

      // Inicia o polling assincronamente sem bloquear o servidor web
      bot.launch().catch(err => {
        console.error('[BotManager] Erro no polling do bot:', err.message);
        isRunning = false;
        startError = err.message;
      });

      console.log(`[BotManager] Bot conectado com sucesso: @${me.username} (${me.first_name})`);
      return { success: true, botInfo: me };
    } catch (err) {
      isRunning = false;
      startError = err.message;
      botInstance = null;
      botInfo = null;
      console.error('[BotManager] Falha ao iniciar bot:', err.message);
      return { success: false, error: err.message };
    }
  },

  async stop() {
    if (botInstance) {
      try {
        botInstance.stop('SIGTERM');
      } catch (_) {}
      botInstance = null;
    }
    isRunning = false;
    console.log('[BotManager] Bot interrompido.');
  },

  getStatus() {
    return {
      isRunning,
      botInfo,
      error: startError,
      hasToken: Boolean(process.env.BOT_TOKEN || Storage.getSettings().botToken)
    };
  },

  async unbanUser(chatId, userId) {
    if (!botInstance || !isRunning) {
      throw new Error('O bot não está em execução.');
    }
    await botInstance.telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
    return true;
  },

  async unmuteUser(chatId, userId) {
    if (!botInstance || !isRunning) {
      throw new Error('O bot não está em execução.');
    }
    // Restaura todas as permissões padrão de envio de mensagens
    await botInstance.telegram.restrictChatMember(chatId, userId, {
      permissions: {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true
      }
    });
    return true;
  }
};
