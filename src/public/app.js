// Estado Global da Aplicação
const state = {
  keywords: [],
  settings: {},
  stats: {},
  bot: {},
  logs: []
};

// Elementos DOM
const elements = {
  botStatusBadge: document.getElementById('botStatusBadge'),
  botStatusText: document.getElementById('botStatusText'),
  btnRefresh: document.getElementById('btnRefresh'),
  tokenWarningBanner: document.getElementById('tokenWarningBanner'),
  statBans: document.getElementById('statBans'),
  statMutes: document.getElementById('statMutes'),
  statKeywords: document.getElementById('statKeywords'),
  statMessages: document.getElementById('statMessages'),
  keywordsBadgeCount: document.getElementById('keywordsBadgeCount'),
  addKeywordForm: document.getElementById('addKeywordForm'),
  newKeywordInput: document.getElementById('newKeywordInput'),
  keywordSearchInput: document.getElementById('keywordSearchInput'),
  keywordsList: document.getElementById('keywordsList'),
  toggleAntiLink: document.getElementById('toggleAntiLink'),
  muteDurationSelect: document.getElementById('muteDurationSelect'),
  toggleDeletePosts: document.getElementById('toggleDeletePosts'),
  togglePublicReport: document.getElementById('togglePublicReport'),
  toggleReporterAdminOnly: document.getElementById('toggleReporterAdminOnly'),
  toggleNotifyChat: document.getElementById('toggleNotifyChat'),
  tokenInput: document.getElementById('tokenInput'),
  btnToggleTokenVisibility: document.getElementById('btnToggleTokenVisibility'),
  btnSaveToken: document.getElementById('btnSaveToken'),
  tokenSourceIndicator: document.getElementById('tokenSourceIndicator'),
  logsTableBody: document.getElementById('logsTableBody'),
  btnReloadLogs: document.getElementById('btnReloadLogs'),
  toastContainer: document.getElementById('toastContainer')
};

// Sistema de Toasts (Notificações)
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span>${message}</span>
  `;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Formatação de data/hora amigável
function formatDate(isoString) {
  if (!isoString) return '--';
  const date = new Date(isoString);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// 1. Carregar Status Geral do Sistema
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.bot = data.bot || {};
    state.stats = data.stats || {};
    
    // Atualiza badges e métricas
    elements.statBans.textContent = state.stats.totalBans || 0;
    elements.statMutes.textContent = state.stats.totalMutes || 0;
    elements.statMessages.textContent = state.stats.totalMessagesChecked || 0;
    elements.statKeywords.textContent = data.keywordsCount || 0;

    // Atualiza status do Bot
    if (state.bot.isRunning && state.bot.botInfo) {
      elements.botStatusBadge.className = 'status-badge online';
      elements.botStatusText.textContent = `Online: @${state.bot.botInfo.username}`;
      elements.tokenWarningBanner.style.display = 'none';
      elements.tokenSourceIndicator.textContent = 'Conectado';
      elements.tokenSourceIndicator.style.color = '#34d399';
    } else if (state.bot.error) {
      elements.botStatusBadge.className = 'status-badge error';
      elements.botStatusText.textContent = 'Erro no Bot';
      elements.tokenWarningBanner.style.display = 'flex';
      elements.tokenSourceIndicator.textContent = 'Erro de Conexão';
      elements.tokenSourceIndicator.style.color = '#f87171';
    } else {
      elements.botStatusBadge.className = 'status-badge offline';
      elements.botStatusText.textContent = 'Aguardando Token';
      elements.tokenWarningBanner.style.display = 'flex';
      elements.tokenSourceIndicator.textContent = 'Sem Token Ativo';
      elements.tokenSourceIndicator.style.color = '#fbbf24';
    }
  } catch (err) {
    console.error('Erro ao buscar status:', err);
  }
}

// 2. Carregar e Renderizar Palavras-chave
async function fetchKeywords() {
  try {
    const res = await fetch('/api/keywords');
    state.keywords = await res.json();
    renderKeywords();
  } catch (err) {
    console.error('Erro ao buscar palavras-chave:', err);
  }
}

function renderKeywords(filterText = '') {
  const filtered = state.keywords.filter(k => 
    k.word.toLowerCase().includes(filterText.toLowerCase())
  );

  elements.keywordsBadgeCount.textContent = `${state.keywords.length} cadastradas`;

  if (filtered.length === 0) {
    if (filterText) {
      elements.keywordsList.innerHTML = `<div class="empty-state">Nenhuma palavra encontrada com o termo "${filterText}".</div>`;
    } else {
      elements.keywordsList.innerHTML = `<div class="empty-state">Nenhuma palavra cadastrada ainda. Adicione palavras proibidas acima.</div>`;
    }
    return;
  }

  elements.keywordsList.innerHTML = filtered.map(item => `
    <div class="keyword-chip" title="Cadastrada em ${formatDate(item.addedAt)}">
      <span>${escapeHtml(item.word)}</span>
      <button class="btn-remove-keyword" data-id="${item.id}" title="Remover palavra">×</button>
    </div>
  `).join('');

  // Eventos de remoção
  elements.keywordsList.querySelectorAll('.btn-remove-keyword').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      await deleteKeyword(id);
    });
  });
}

async function addKeyword(word) {
  try {
    const res = await fetch('/api/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Erro ao adicionar palavra.', 'error');
      return;
    }
    showToast(`Palavra "${word}" proibida adicionada com sucesso!`, 'success');
    elements.newKeywordInput.value = '';
    await fetchKeywords();
    await fetchStatus();
  } catch (err) {
    showToast('Falha na comunicação com o servidor.', 'error');
  }
}

async function deleteKeyword(id) {
  try {
    const res = await fetch(`/api/keywords/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || 'Erro ao remover palavra.', 'error');
      return;
    }
    showToast('Palavra removida da lista.', 'info');
    await fetchKeywords();
    await fetchStatus();
  } catch (err) {
    showToast('Falha na comunicação com o servidor.', 'error');
  }
}

// 3. Carregar e Atualizar Configurações
async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    state.settings = await res.json();

    elements.toggleAntiLink.checked = Boolean(state.settings.antiLink);
    elements.muteDurationSelect.value = String(state.settings.muteDurationMinutes ?? 60);
    elements.toggleDeletePosts.checked = Boolean(state.settings.deleteBannedUserPosts !== false);
    elements.togglePublicReport.checked = Boolean(state.settings.publicReportEnabled !== false);
    elements.toggleReporterAdminOnly.checked = Boolean(state.settings.reporterMustBeAdmin);
    elements.toggleNotifyChat.checked = Boolean(state.settings.notifyInChat !== false);
  } catch (err) {
    console.error('Erro ao buscar configurações:', err);
  }
}

async function updateSetting(payload) {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('Configuração atualizada com sucesso!', 'success');
    }
  } catch (err) {
    showToast('Erro ao salvar configuração.', 'error');
  }
}

// 4. Carregar Logs de Auditoria
async function fetchLogs() {
  try {
    const res = await fetch('/api/logs?limit=40');
    state.logs = await res.json();
    renderLogs();
  } catch (err) {
    console.error('Erro ao carregar logs:', err);
  }
}

function renderLogs() {
  if (!state.logs || state.logs.length === 0) {
    elements.logsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">Nenhuma punição registrada até o momento. O bot está monitorando!</td>
      </tr>
    `;
    return;
  }

  elements.logsTableBody.innerHTML = state.logs.map(log => {
    const isBan = log.action === 'BAN';
    const actionBadge = isBan
      ? '<span class="badge-action ban">BANIDO</span>'
      : '<span class="badge-action mute">SILENCIADO</span>';

    const revertBtn = log.reverted
      ? '<span class="badge-reverted">✓ Revertido</span>'
      : `<button class="btn-action-revert" data-log-id="${log.id}" data-action="${log.action}" data-chat="${log.chatId}" data-user="${log.userId}">
          ${isBan ? 'Desbanir' : 'Desmutar'}
        </button>`;

    return `
      <tr>
        <td style="color: var(--text-muted); font-size: 0.8rem; white-space: nowrap;">
          ${formatDate(log.timestamp)}
        </td>
        <td>${actionBadge}</td>
        <td>
          <div class="user-cell">
            <span class="user-name">${escapeHtml(log.userName)}</span>
            <span class="user-tag">${escapeHtml(log.userTag || `ID: ${log.userId}`)}</span>
          </div>
        </td>
        <td>
          <div style="font-size: 0.85rem; font-weight: 500;">${escapeHtml(log.chatTitle)}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${log.chatId}</div>
        </td>
        <td>
          <div style="font-size: 0.84rem; font-weight: 600; color: #cbd5e1;">${escapeHtml(log.reason)}</div>
          ${log.textSnippet ? `<span class="text-snippet" title="${escapeHtml(log.textSnippet)}">"${escapeHtml(log.textSnippet)}"</span>` : ''}
        </td>
        <td>${revertBtn}</td>
      </tr>
    `;
  }).join('');

  // Adiciona listeners para botões de reversão
  elements.logsTableBody.querySelectorAll('.btn-action-revert').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      const logId = b.getAttribute('data-log-id');
      const action = b.getAttribute('data-action');
      const chatId = b.getAttribute('data-chat');
      const userId = b.getAttribute('data-user');
      await revertAction(logId, action, chatId, userId);
    });
  });
}

async function revertAction(logId, action, chatId, userId) {
  const isBan = action === 'BAN';
  const endpoint = isBan ? '/api/moderation/unban' : '/api/moderation/unmute';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId, chatId, userId })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Falha ao reverter punição.', 'error');
      return;
    }
    showToast(isBan ? 'Usuário desbanido do grupo!' : 'Usuário desmutado com sucesso!', 'success');
    await fetchLogs();
  } catch (err) {
    showToast('Erro ao comunicar com o bot.', 'error');
  }
}

// 5. Salvar Token do Bot
async function saveBotToken() {
  const token = elements.tokenInput.value.trim();
  if (!token) {
    showToast('Por favor, digite um token válido.', 'error');
    return;
  }

  elements.btnSaveToken.textContent = 'Conectando...';
  elements.btnSaveToken.disabled = true;

  try {
    const res = await fetch('/api/bot/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Token inválido ou falha ao iniciar o bot.', 'error');
      return;
    }

    showToast(`Bot conectado com sucesso como @${data.botInfo.username}!`, 'success');
    elements.tokenInput.value = '';
    await fetchStatus();
  } catch (err) {
    showToast('Erro na requisição ao servidor.', 'error');
  } finally {
    elements.btnSaveToken.textContent = 'Salvar & Conectar';
    elements.btnSaveToken.disabled = false;
  }
}

// Utilitário de escape de HTML contra XSS
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Event Listeners
function setupEvents() {
  // Adicionar palavra
  elements.addKeywordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = elements.newKeywordInput.value.trim();
    if (word) {
      await addKeyword(word);
    }
  });

  // Filtro de busca de palavras
  elements.keywordSearchInput.addEventListener('input', (e) => {
    renderKeywords(e.target.value);
  });

  // Toggle Anti-Link
  elements.toggleAntiLink.addEventListener('change', (e) => {
    updateSetting({ antiLink: e.target.checked });
  });

  // Duração de Mute
  elements.muteDurationSelect.addEventListener('change', (e) => {
    updateSetting({ muteDurationMinutes: Number(e.target.value) });
  });

  // Toggle Excluir Posts
  elements.toggleDeletePosts.addEventListener('change', (e) => {
    updateSetting({ deleteBannedUserPosts: e.target.checked });
  });

  // Toggle Denúncia de Conteúdo Ilícito
  elements.togglePublicReport.addEventListener('change', (e) => {
    updateSetting({ publicReportEnabled: e.target.checked });
  });

  // Toggle Apenas Admins podem Denunciar
  elements.toggleReporterAdminOnly.addEventListener('change', (e) => {
    updateSetting({ reporterMustBeAdmin: e.target.checked });
  });

  // Toggle Notificação no Chat
  elements.toggleNotifyChat.addEventListener('change', (e) => {
    updateSetting({ notifyInChat: e.target.checked });
  });

  // Salvar Token
  elements.btnSaveToken.addEventListener('click', saveBotToken);

  // Alternar Visibilidade do Token
  elements.btnToggleTokenVisibility.addEventListener('click', () => {
    const isPass = elements.tokenInput.type === 'password';
    elements.tokenInput.type = isPass ? 'text' : 'password';
    elements.btnToggleTokenVisibility.textContent = isPass ? '🙈' : '👁️';
  });

  // Botões de recarregar
  elements.btnRefresh.addEventListener('click', async () => {
    await Promise.all([fetchStatus(), fetchKeywords(), fetchSettings(), fetchLogs()]);
    showToast('Dados atualizados!', 'info');
  });

  elements.btnReloadLogs.addEventListener('click', async () => {
    await fetchLogs();
    showToast('Logs recarregados!', 'info');
  });
}

// Inicialização
async function init() {
  setupEvents();
  await Promise.all([fetchStatus(), fetchKeywords(), fetchSettings(), fetchLogs()]);

  // Polling automático suave de status e logs a cada 5 segundos
  setInterval(() => {
    fetchStatus();
    fetchLogs();
  }, 5000);
}

document.addEventListener('DOMContentLoaded', init);
