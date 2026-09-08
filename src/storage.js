import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'settings.json');

// Garante que o diretório data/ existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_DATA = {
  keywords: [
    { id: '1', word: 'spam', addedAt: new Date().toISOString() },
    { id: '2', word: 'golpe', addedAt: new Date().toISOString() },
    { id: '3', word: 'cripto piramide', addedAt: new Date().toISOString() }
  ],
  settings: {
    antiLink: true,
    muteDurationMinutes: 60, // 0 = permanente (ou até ser desmutado)
    deleteBannedUserPosts: true, // banChatMember revoke_messages: true
    notifyInChat: true, // Avisar no chat quando alguém for punido
    botToken: ''
  },
  stats: {
    totalBans: 0,
    totalMutes: 0,
    totalMessagesChecked: 0
  },
  logs: []
};

let cachedData = null;

function loadData() {
  if (cachedData) return cachedData;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      cachedData = { ...DEFAULT_DATA, ...JSON.parse(raw) };
      // Garante que sub-objetos tenham os campos padrão
      cachedData.settings = { ...DEFAULT_DATA.settings, ...(cachedData.settings || {}) };
      cachedData.stats = { ...DEFAULT_DATA.stats, ...(cachedData.stats || {}) };
      cachedData.keywords = cachedData.keywords || [];
      cachedData.logs = cachedData.logs || [];
      return cachedData;
    }
  } catch (err) {
    console.error('[Storage] Erro ao carregar arquivo de dados:', err);
  }
  cachedData = JSON.parse(JSON.stringify(DEFAULT_DATA));
  saveData();
  return cachedData;
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(cachedData, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Storage] Erro ao salvar dados:', err);
  }
}

export const Storage = {
  get() {
    return loadData();
  },

  getKeywords() {
    return loadData().keywords;
  },

  addKeyword(word) {
    const data = loadData();
    const clean = word.trim().toLowerCase();
    if (!clean) return { success: false, error: 'Palavra inválida' };
    
    const exists = data.keywords.some(k => k.word.toLowerCase() === clean);
    if (exists) return { success: false, error: 'Palavra-chave já cadastrada' };

    const newItem = {
      id: Date.now().toString(),
      word: clean,
      addedAt: new Date().toISOString()
    };
    data.keywords.unshift(newItem);
    saveData();
    return { success: true, item: newItem };
  },

  removeKeyword(id) {
    const data = loadData();
    const initialLen = data.keywords.length;
    data.keywords = data.keywords.filter(k => k.id !== id && k.word !== id);
    if (data.keywords.length !== initialLen) {
      saveData();
      return { success: true };
    }
    return { success: false, error: 'Palavra-chave não encontrada' };
  },

  getSettings() {
    const data = loadData();
    return {
      ...data.settings,
      hasEnvToken: Boolean(process.env.BOT_TOKEN)
    };
  },

  updateSettings(newSettings) {
    const data = loadData();
    data.settings = {
      ...data.settings,
      ...newSettings
    };
    saveData();
    return { success: true, settings: data.settings };
  },

  getStats() {
    return loadData().stats;
  },

  incrementStat(statName) {
    const data = loadData();
    if (data.stats[statName] !== undefined) {
      data.stats[statName] += 1;
    } else {
      data.stats[statName] = 1;
    }
    saveData();
  },

  addLog(entry) {
    const data = loadData();
    const logItem = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      action: entry.action, // 'BAN' | 'MUTE'
      userId: entry.userId,
      userName: entry.userName || 'Desconhecido',
      userTag: entry.userTag || '',
      chatId: entry.chatId,
      chatTitle: entry.chatTitle || 'Grupo',
      reason: entry.reason,
      textSnippet: (entry.text || '').substring(0, 150),
      reverted: false
    };

    data.logs.unshift(logItem);
    // Manter no máximo os últimos 200 logs
    if (data.logs.length > 200) {
      data.logs = data.logs.slice(0, 200);
    }
    saveData();
    return logItem;
  },

  getLogs(limit = 50) {
    return loadData().logs.slice(0, limit);
  },

  markLogReverted(logId) {
    const data = loadData();
    const log = data.logs.find(l => l.id === logId);
    if (log) {
      log.reverted = true;
      saveData();
      return true;
    }
    return false;
  }
};
