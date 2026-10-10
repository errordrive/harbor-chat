// Conversation persistence (browser localStorage), namespaced per user account
// so two accounts on one browser never see each other's chats.
const LEGACY_KEY = 'harbor_chat_convos_v1'; // pre-accounts (v3.1) single-user key
let KEY = LEGACY_KEY;

/** Call once after sign-in, before loadConvos(). Adopts v3.1 chats for the first account. */
export function setStoreUser(userId) {
  KEY = LEGACY_KEY + ':' + userId;
  try {
    if (localStorage.getItem(KEY) === null) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        localStorage.setItem(KEY, legacy);
        localStorage.removeItem(LEGACY_KEY);
      }
    }
  } catch (e) {}
}

export function loadConvos() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

export function saveConvos(convos) {
  try { localStorage.setItem(KEY, JSON.stringify(convos)); } catch (e) {}
}

export function newConvo(model) {
  return {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: 'New chat',
    model,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function titleFrom(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 44 ? t.slice(0, 44) + '…' : t;
}
