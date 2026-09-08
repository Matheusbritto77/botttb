import assert from 'assert';
import { Storage } from '../src/storage.js';

console.log('--- Iniciando Testes Unitários de Moderação ---');

// 1. Testes de Storage
console.log('1. Testando Storage de Palavras-Chave...');
const initialCount = Storage.getKeywords().length;
const addRes = Storage.addKeyword('teste_proibido_123');
assert.strictEqual(addRes.success, true, 'Deveria adicionar palavra-chave');

const duplicateRes = Storage.addKeyword('teste_proibido_123');
assert.strictEqual(duplicateRes.success, false, 'Não deveria permitir palavra duplicada');

const removeRes = Storage.removeKeyword(addRes.item.id);
assert.strictEqual(removeRes.success, true, 'Deveria remover palavra-chave');
assert.strictEqual(Storage.getKeywords().length, initialCount, 'Contagem deve voltar ao inicial');
console.log('✓ Storage de palavras-chave OK');

// 2. Testes de Configurações
console.log('2. Testando Storage de Configurações...');
Storage.updateSettings({ antiLink: false, muteDurationMinutes: 120 });
let settings = Storage.getSettings();
assert.strictEqual(settings.antiLink, false);
assert.strictEqual(settings.muteDurationMinutes, 120);

// Restaura
Storage.updateSettings({ antiLink: true, muteDurationMinutes: 60 });
settings = Storage.getSettings();
assert.strictEqual(settings.antiLink, true);
assert.strictEqual(settings.muteDurationMinutes, 60);
console.log('✓ Storage de configurações OK');

// 3. Testes de Regex de Link
console.log('3. Testando Detecção de Links...');
const URL_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)|(telegram\.me\/[^\s]+)|((?<!@)\b[a-zA-Z0-9-]+\.(com|org|net|io|me|xyz|app|site|online|store|tech|info|co|cc|tv|br|ru|vip|top|club|link)\b([\/\w\.-]*))/i;

const testLinks = [
  'entre no grupo https://t.me/canal',
  'visite www.google.com agora',
  'compre em shop.xyz/promo',
  't.me/meugrupo',
  'http://localhost:3000',
  'acesse site.com.br/teste'
];

for (const text of testLinks) {
  assert.strictEqual(URL_REGEX.test(text), true, `Deveria detectar link em: "${text}"`);
}

const safeTexts = [
  'olá pessoal tudo bem?',
  'vamos nos encontrar as 15h',
  'meu email é usuario@gmail.com', // email sem url não deve disparar regex direto
  'comprei 10.5 maças'
];

for (const text of safeTexts) {
  // text shouldn't trigger url
  const hasUrl = URL_REGEX.test(text);
  assert.strictEqual(hasUrl, false, `Não deveria acusar link em: "${text}"`);
}
console.log('✓ Detecção de Links OK');

// 4. Testes de Logs e Auditoria
console.log('4. Testando Logs de Auditoria...');
const logItem = Storage.addLog({
  action: 'BAN',
  userId: 123456,
  userName: 'Fulano',
  userTag: '@fulano',
  chatId: -1001234567,
  chatTitle: 'Grupo Teste',
  reason: 'Palavra proibida: "spam"',
  text: 'este é um spam'
});

assert.strictEqual(logItem.userId, 123456);
assert.strictEqual(logItem.reverted, false);

const reverted = Storage.markLogReverted(logItem.id);
assert.strictEqual(reverted, true);

const updatedLog = Storage.getLogs(5).find(l => l.id === logItem.id);
assert.strictEqual(updatedLog.reverted, true);
console.log('✓ Logs de Auditoria OK');

console.log('--- TODOS OS TESTES PASSARAM COM SUCESSO! ---');
