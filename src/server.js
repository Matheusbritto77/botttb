import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Storage } from './storage.js';
import { BotManager } from './bot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // --- Rotas de Status e Estatísticas ---
  app.get('/api/status', (req, res) => {
    const botStatus = BotManager.getStatus();
    const stats = Storage.getStats();
    const settings = Storage.getSettings();
    const keywordsCount = Storage.getKeywords().length;

    res.json({
      bot: botStatus,
      stats,
      settings: {
        antiLink: settings.antiLink,
        muteDurationMinutes: settings.muteDurationMinutes,
        deleteBannedUserPosts: settings.deleteBannedUserPosts,
        hasEnvToken: settings.hasEnvToken
      },
      keywordsCount
    });
  });

  // --- Rotas de Palavras-chave ---
  app.get('/api/keywords', (req, res) => {
    res.json(Storage.getKeywords());
  });

  app.post('/api/keywords', (req, res) => {
    const { word } = req.body;
    if (!word || typeof word !== 'string') {
      return res.status(400).json({ error: 'A palavra-chave é obrigatória.' });
    }
    const result = Storage.addKeyword(word);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.status(201).json(result.item);
  });

  app.delete('/api/keywords/:id', (req, res) => {
    const { id } = req.params;
    const result = Storage.removeKeyword(id);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    res.json({ success: true });
  });

  // --- Rotas de Configurações ---
  app.get('/api/settings', (req, res) => {
    res.json(Storage.getSettings());
  });

  app.post('/api/settings', (req, res) => {
    const { antiLink, muteDurationMinutes, deleteBannedUserPosts, notifyInChat } = req.body;
    const updates = {};
    if (typeof antiLink === 'boolean') updates.antiLink = antiLink;
    if (typeof deleteBannedUserPosts === 'boolean') updates.deleteBannedUserPosts = deleteBannedUserPosts;
    if (typeof notifyInChat === 'boolean') updates.notifyInChat = notifyInChat;
    if (muteDurationMinutes !== undefined) {
      const minutes = Number(muteDurationMinutes);
      if (!isNaN(minutes) && minutes >= 0) {
        updates.muteDurationMinutes = minutes;
      }
    }

    const updated = Storage.updateSettings(updates);
    res.json(updated);
  });

  // Configuração do Token do Bot via Painel
  app.post('/api/bot/token', async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token inválido.' });
    }

    Storage.updateSettings({ botToken: token.trim() });
    const startResult = await BotManager.start(token.trim());
    if (!startResult.success) {
      return res.status(400).json({ error: startResult.error });
    }
    res.json({ success: true, botInfo: startResult.botInfo });
  });

  app.post('/api/bot/restart', async (req, res) => {
    const startResult = await BotManager.start();
    res.json(startResult);
  });

  // --- Rotas de Logs e Auditoria ---
  app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    res.json(Storage.getLogs(limit));
  });

  // Desbanir membro
  app.post('/api/moderation/unban', async (req, res) => {
    const { logId, chatId, userId } = req.body;
    if (!chatId || !userId) {
      return res.status(400).json({ error: 'chatId e userId são obrigatórios.' });
    }

    try {
      await BotManager.unbanUser(chatId, userId);
      if (logId) Storage.markLogReverted(logId);
      res.json({ success: true, message: 'Usuário desbanido com sucesso.' });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erro ao desbanir usuário.' });
    }
  });

  // Desmutar membro
  app.post('/api/moderation/unmute', async (req, res) => {
    const { logId, chatId, userId } = req.body;
    if (!chatId || !userId) {
      return res.status(400).json({ error: 'chatId e userId são obrigatórios.' });
    }

    try {
      await BotManager.unmuteUser(chatId, userId);
      if (logId) Storage.markLogReverted(logId);
      res.json({ success: true, message: 'Usuário desmutado com sucesso.' });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Erro ao desmutar usuário.' });
    }
  });

  // Fallback para SPA se necessário
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}
