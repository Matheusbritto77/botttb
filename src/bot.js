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
 * Verifica se a mensagem é o comando único /denuncia
 */
function isDenunciaCommand(text) {
  if (!text) return false;
  const firstWord = text.trim().toLowerCase().split(/\s+/)[0];
  return firstWord === '/denuncia' || firstWord.startsWith('/denuncia@');
}

// Armazena em memória os IDs de mensagens recentes de cada usuário por chat para exclusão completa
const recentUserMessages = new Map();

function trackUserMessage(chatId, userId, messageId) {
  const key = `${chatId}:${userId}`;
  if (!recentUserMessages.has(key)) {
    recentUserMessages.set(key, []);
  }
  const list = recentUserMessages.get(key);
  list.push(messageId);
  if (list.length > 80) list.shift();
}

async function deleteUserMessagesFromMemory(ctx, chatId, userId) {
  const key = `${chatId}:${userId}`;
  const list = recentUserMessages.get(key) || [];
  if (list.length > 0) {
    try {
      await ctx.telegram.callApi('deleteMessages', {
        chat_id: chatId,
        message_ids: list
      });
    } catch (_) {
      for (const msgId of list) {
        ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
      }
    }
    recentUserMessages.delete(key);
  }
}

/**
 * Descreve o conteúdo ou tipo de mídia de uma mensagem
 */
function describeMessageContent(msg) {
  if (!msg) return 'Conteúdo desconhecido';
  if (msg.text) return msg.text;
  if (msg.caption) return `[Legenda] ${msg.caption}`;
  if (msg.photo) return '[Foto/Imagem]';
  if (msg.video) return '[Vídeo]';
  if (msg.animation) return '[GIF/Animação]';
  if (msg.document) return `[Documento: ${msg.document.file_name || 'arquivo'}]`;
  if (msg.voice) return '[Áudio/Voz]';
  if (msg.audio) return '[Áudio/Música]';
  if (msg.sticker) return `[Sticker ${msg.sticker.emoji || ''}]`;
  return '[Mídia/Conteúdo]';
}

/**
 * Verifica se determinado usuário é Administrador ou Criador do grupo
 */
async function isMemberAdmin(ctx, userId) {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    const member = await ctx.getChatMember(userId);
    return member.status === 'administrator' || member.status === 'creator';
  } catch (err) {
    return false;
  }
}

/**
 * Verifica se o remetente atual é Administrador ou Criador do grupo
 */
async function isUserAdmin(ctx) {
  return isMemberAdmin(ctx, ctx.from.id);
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
        '• Moderação de palavras proibidas e anti-link automática.\n' +
        '• <b>Denúncia de Conteúdo Ilícito:</b> Qualquer membro pode responder a uma mensagem ilícita com o comando único <code>/denuncia</code> para banir o autor e excluir todas as mídias e posts dele no grupo!\n\n' +
        'Por favor me promova a <b>Administrador</b> com permissões para <i>Excluir mensagens</i> e <i>Banir usuários</i>.',
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
        return ctx.reply('👋 Olá! Sou o Bot de Moderação. Adicione-me a um grupo como Administrador para gerenciar palavras proibidas, links e denúncias de conteúdo com o comando /denuncia.');
      }
      return;
    }

    // Não monitora o próprio bot
    if (ctx.from.is_bot) return;

    Storage.incrementStat('totalMessagesChecked');

    // Rastreia ID da mensagem para exclusão caso o usuário venha a ser banido
    trackUserMessage(ctx.chat.id, ctx.from.id, message.message_id);

    const text = message.text || message.caption || '';
    const settings = Storage.getSettings();

    // --- RECURSO: COMANDO ÚNICO /denuncia PARA BANIR E EXCLUIR MENSAGENS E MÍDIAS ---
    if (settings.publicReportEnabled !== false && isDenunciaCommand(text)) {
      const reportedMsg = message.reply_to_message;

      // Se não respondeu a nenhuma mensagem, envia guia de como usar
      if (!reportedMsg) {
        await ctx.deleteMessage(message.message_id).catch(() => {});
        await sendTempWarning(
          ctx,
          'ℹ️ <b>Como usar o comando /denuncia:</b>\nResponda diretamente (Reply) à mensagem ou mídia suspeita digitando <code>/denuncia</code> para banir o usuário e excluir todas as mensagens dele do grupo.',
          8000
        );
        return;
      }

      // Verifica se há restrição para apenas admins denunciarem
      if (settings.reporterMustBeAdmin) {
        const isReporterAdmin = await isMemberAdmin(ctx, ctx.from.id);
        if (!isReporterAdmin) {
          await ctx.deleteMessage(message.message_id).catch(() => {});
          await sendTempWarning(ctx, '⚠️ Apenas administradores podem utilizar o comando <code>/denuncia</code>.', 6000);
          return;
        }
      }

      const reportedUser = reportedMsg.from;

      // Mensagens anônimas de canal / grupo
      if (!reportedUser) {
        await ctx.deleteMessage(reportedMsg.message_id).catch(() => {});
        await ctx.deleteMessage(message.message_id).catch(() => {});
        await sendTempWarning(ctx, '🚨 Mensagem anônima/canal removida.', 6000);
        return;
      }

      // Não permite banir bots
      if (reportedUser.is_bot) {
        await ctx.deleteMessage(message.message_id).catch(() => {});
        await sendTempWarning(ctx, '⚠️ Não é possível banir um bot do sistema.', 6000);
        return;
      }

      // Não permite banir administradores do grupo
      const isTargetAdmin = await isMemberAdmin(ctx, reportedUser.id);
      if (isTargetAdmin) {
        await ctx.deleteMessage(message.message_id).catch(() => {});
        await sendTempWarning(ctx, '⚠️ <b>Ação bloqueada:</b> O usuário é Administrador/Dono do grupo e o Telegram não permite que bots banam administradores.', 7000);
        return;
      }

      console.log(`[Denúncia] /denuncia acionado por ${ctx.from.first_name} contra ${reportedUser.first_name} (${reportedUser.id})`);

      // 1. Apaga a mensagem de comando /denuncia
      await ctx.deleteMessage(message.message_id).catch(() => {});

      // 2. Apaga a mensagem/mídia marcada
      await ctx.deleteMessage(reportedMsg.message_id).catch(() => {});

      // 3. Aplica o banimento no usuário infrator com revoke_messages: true (Telegram Bot API nativo)
      let banSuccess = false;
      let banErrorMessage = '';
      try {
        await ctx.telegram.callApi('banChatMember', {
          chat_id: ctx.chat.id,
          user_id: reportedUser.id,
          revoke_messages: true
        });
        banSuccess = true;
      } catch (err) {
        banErrorMessage = err.message || '';
        console.error('[Denúncia] Falha ao banir usuário denunciado:', err.message);
      }

      if (banSuccess) {
        // 4. Exclui também mensagens recentes rastreadas desse usuário para garantir exclusão completa
        await deleteUserMessagesFromMemory(ctx, ctx.chat.id, reportedUser.id);

        const contentDesc = describeMessageContent(reportedMsg);
        const reporterTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
        const reportedTag = reportedUser.username ? `@${reportedUser.username}` : `ID: ${reportedUser.id}`;

        Storage.incrementStat('totalBans');
        Storage.addLog({
          action: 'BAN',
          userId: reportedUser.id,
          userName: [reportedUser.first_name, reportedUser.last_name].filter(Boolean).join(' ') || reportedUser.username || 'Sem nome',
          userTag: reportedTag,
          chatId: ctx.chat.id,
          chatTitle: ctx.chat.title,
          reason: `Denúncia via /denuncia feita por ${reporterTag}`,
          text: contentDesc
        });

        await sendTempWarning(
          ctx,
          `🚨 <b>Usuário Banido e Conteúdo Excluído!</b>\n` +
          `<b>Infrator:</b> ${reportedUser.first_name} (${reportedTag})\n` +
          `<b>Ação:</b> Usuário banido e todas as suas mensagens e mídias foram excluídas do grupo via <code>/denuncia</code>.\n` +
          `<b>Denunciado por:</b> ${reporterTag}`
        );
      } else {
        let msg = `⚠️ <b>Não foi possível banir ${reportedUser.first_name}.</b>\n`;
        if (banErrorMessage.includes('not enough rights') || banErrorMessage.includes("can't restrict")) {
          msg += 'O bot precisa da permissão de Administrador para <b>Banir Usuários</b> (<code>can_restrict_members</code>). Por favor, conceda essa permissão nas configurações do grupo.';
        } else if (banErrorMessage.includes('owner') || banErrorMessage.includes('administrator')) {
          msg += 'O Telegram não permite banir Administradores ou Donos do grupo.';
        } else {
          msg += `Erro retornado pelo Telegram: ${banErrorMessage}`;
        }
        await sendTempWarning(ctx, msg, 10000);
      }
      return;
    }

    // Administradores são isentos das restrições de palavras e links
    const admin = await isUserAdmin(ctx);
    if (admin) return;

    const keywords = Storage.getKeywords();

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
        await ctx.telegram.callApi('banChatMember', {
          chat_id: ctx.chat.id,
          user_id: ctx.from.id,
          revoke_messages: settings.deleteBannedUserPosts !== false
        });
        banSuccess = true;
      } catch (err) {
        console.error('[Moderação] Falha ao banir membro (verifique permissões de admin do bot):', err.message);
      }

      if (banSuccess) {
        // Exclui também mensagens rastreadas do usuário
        await deleteUserMessagesFromMemory(ctx, ctx.chat.id, ctx.from.id);

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
