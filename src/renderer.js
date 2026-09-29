import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './style.css';
const $ = id => document.getElementById(id);
const sessions = new Map();
let activeId = null;
let serial = 0;
let creating = false;
let renameTarget = null;
let menuTarget = null;
let preferences = { theme: 'system', fontSize: 14, lineNumbers: true };
try { const p = JSON.parse(localStorage.getItem('harbor-appearance')); if (p) { preferences.lineNumbers = p.lineNumbers !== false; preferences.theme = ['system', 'dark', 'light'].includes(p.theme) ? p.theme : 'system'; preferences.fontSize = Math.min(24, Math.max(11, Number(p.fontSize) || 14)); } } catch {}
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => preferences.theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preferences.theme;
systemTheme.addEventListener('change', () => { if (preferences.theme === 'system') appearance(); });
const themes = {
  dark: { background: '#1c1d1f', foreground: '#d9dbdf', cursor: '#b0ddc3', selectionBackground: '#40554a', black: '#44464e', red: '#ee8e93', green: '#a0cfa5', yellow: '#e8c58e', blue: '#92b8ec', magenta: '#c6a4df', cyan: '#8dcdd0', white: '#dedfe3', brightBlack: '#828590', brightRed: '#f5a3a7', brightGreen: '#b8dfbb', brightYellow: '#f0d6ae', brightBlue: '#b4ccf4', brightMagenta: '#dbbcec', brightCyan: '#a9e1e3', brightWhite: '#ffffff' },
  light: { background: '#faf9f6', foreground: '#313638', cursor: '#397258', selectionBackground: '#cfe2d5', black: '#343637', red: '#b4414b', green: '#3d7352', yellow: '#946b24', blue: '#3466a4', magenta: '#8858a4', cyan: '#287c87', white: '#d8d8d3', brightBlack: '#7b7d79', brightRed: '#ba4f5b', brightGreen: '#49815d', brightYellow: '#997531', brightBlue: '#4578b6', brightMagenta: '#9c6bb4', brightCyan: '#378a93', brightWhite: '#efeeea' }
};
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 4000); }
// Numbers identify physical rows in the retained buffer, including wrapped rows.
// Use the rendered grid height so font metrics and device scale stay aligned.
function renderLineNumbers(s) {
  if (s.id !== activeId || !preferences.lineNumbers) return;
  const screen = s.host.querySelector('.xterm-screen');
  const rowHeight = screen?.getBoundingClientRect().height / s.term.rows;
  if (!rowHeight) return;
  const buffer = s.term.buffer.active;
  s.gutter.style.fontSize = `${s.term.options.fontSize}px`;
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < s.term.rows; row++) {
    const number = document.createElement('div');
    number.className = 'line-number';
    number.style.height = `${rowHeight}px`;
    number.style.lineHeight = `${rowHeight}px`;
    number.textContent = String(buffer.viewportY + row + 1);
    fragment.append(number);
  }
  s.gutter.replaceChildren(fragment);
}
function queueLineNumbers(s) {
  if (s.numberFrame || s.id !== activeId) return;
  s.numberFrame = requestAnimationFrame(() => {
    s.numberFrame = 0;
    if (sessions.has(s.id)) renderLineNumbers(s);
  });
}
function fit(s) { if (!s || s.id !== activeId) return; try { s.fit.fit(); if (s.live) window.harbor.resize(s.id, s.term.cols, s.term.rows); $('dimensions').textContent = `${s.term.cols} × ${s.term.rows}`; queueLineNumbers(s); } catch {} }
function refreshHeader() {
  const s = sessions.get(activeId);
  $('active-title').textContent = s?.name || '终端';
  $('active-shell').textContent = s?.shell || '—';
  $('cwd').textContent = s ? `启动目录 · ${s.cwd}` : '本地终端';
  const stateLabel = s ? (s.live ? '会话运行中（可能正在等待输入）' : '会话已结束') : '没有打开的终端';
  $('session-state').dataset.state = s?.live ? 'running' : 'ended';
  $('session-state').title = stateLabel;
  $('session-state').setAttribute('aria-label', stateLabel);
  $('session-state').hidden = !s;
  $('footer-status').textContent = s ? (s.live ? `${s.shell} · 本地会话` : `进程已退出 · ${s.exitCode}`) : '没有打开的终端';
  $('status-dot').classList.toggle('inactive', !s?.live);
  for (const id of ['rename', 'clear', 'close-terminal']) $(id).disabled = !s;
  $('empty').hidden = sessions.size !== 0;
  if (!s) $('dimensions').textContent = '—';
}
function renderList() {
  $('sessions').replaceChildren();
  $('count').textContent = sessions.size;
  for (const s of sessions.values()) {
    const row = document.createElement('div'); row.className = 'session-row';
    const button = document.createElement('button');
    button.className = `session-item${s.id === activeId ? ' active' : ''}`;
    button.dataset.id = s.id;
    button.setAttribute('aria-current', String(s.id === activeId));
    const icon = document.createElement('span'); icon.className = 'session-icon'; icon.textContent = '›_';
    const text = document.createElement('span'); text.className = 'session-text';
    const name = document.createElement('span'); name.className = 'session-name'; name.textContent = s.name;
    const sub = document.createElement('span'); sub.className = 'session-sub'; sub.textContent = `${s.shell} · ${s.live ? (s.cwd.split('/').pop() || '/') : '已结束'}`;
    text.append(name, sub);
    const dot = document.createElement('span'); dot.className = `session-indicator${s.unread ? ' unread' : ''}${!s.live ? ' ended' : ''}`;
    button.append(icon, text, dot);
    button.onclick = () => activate(s.id);
    button.ondblclick = () => rename(s.id);
    const more = document.createElement('button');
    more.className = 'session-more'; more.textContent = '⋯'; more.dataset.id = s.id;
    more.setAttribute('aria-label', `${s.name} 的操作菜单`);
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-controls', 'session-menu');
    more.setAttribute('aria-expanded', String(menuTarget === s.id));
    more.onclick = () => menuTarget === s.id ? closeSessionMenu(true) : openSessionMenu(s.id);
    more.onkeydown = event => { if (event.key === 'ArrowDown') { event.preventDefault(); openSessionMenu(s.id); } };
    button.oncontextmenu = event => { event.preventDefault(); openSessionMenu(s.id); };
    row.append(button, more); $('sessions').append(row);
  }
}
function closeSessionMenu(restoreFocus = false) {
  const id = menuTarget;
  menuTarget = null;
  $('session-menu').hidden = true;
  const trigger = document.querySelector(`.session-more[data-id="${id}"]`);
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger?.focus();
}
function openSessionMenu(id) {
  closeSessionMenu();
  const s = sessions.get(id);
  const trigger = document.querySelector(`.session-more[data-id="${id}"]`);
  if (!s || !trigger) return;
  menuTarget = id;
  trigger.setAttribute('aria-expanded', 'true');
  const menu = $('session-menu');
  menu.setAttribute('aria-label', `${s.name} 的操作`);
  menu.hidden = false;
  const rect = trigger.getBoundingClientRect();
  const height = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${rect.bottom + height + 8 > innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4}px`;
  $('session-menu-rename').focus();
}
$('session-menu-rename').onclick = () => { const id = menuTarget; closeSessionMenu(); rename(id); };
$('session-menu-delete').onclick = () => { const id = menuTarget; closeSessionMenu(); closeSession(id); };
document.addEventListener('pointerdown', event => {
  if (menuTarget && !$('session-menu').contains(event.target) && !event.target.closest('.session-more')) closeSessionMenu();
});
$('session-menu').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSessionMenu(true); }
  if (event.key === 'Tab') closeSessionMenu(true);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const items = [...$('session-menu').querySelectorAll('button')];
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }
});
$('sessions').addEventListener('scroll', () => closeSessionMenu());
window.addEventListener('resize', () => closeSessionMenu());
window.addEventListener('blur', () => closeSessionMenu());
function activate(id) {
  closeSessionMenu();
  activeId = id;
  for (const s of sessions.values()) s.element.hidden = s.id !== id;
  const s = sessions.get(id);
  if (s) { s.unread = false; requestAnimationFrame(() => { fit(s); s.term.focus(); }); }
  renderList(); refreshHeader();
}
async function create(folder = false) {
  if (creating) return;
  creating = true; $('new-terminal').disabled = true;
  try {
    const info = await window.harbor.create(folder);
    if (!info) return;
    const element = document.createElement('div'); element.className = 'terminal-pane'; element.dataset.id = info.id; $('terminals').append(element);
    const term = new Terminal({ cursorBlink: true, cursorStyle: 'bar', fontSize: preferences.fontSize, fontFamily: '"SFMono-Regular", Menlo, Monaco, monospace', lineHeight: 1.35, scrollback: 10000, theme: themes[resolvedTheme()], allowProposedApi: false, macOptionIsMeta: true });
    const gutter = document.createElement('div'); gutter.className = 'line-numbers'; gutter.style.fontSize = `${preferences.fontSize}px`; gutter.setAttribute('aria-hidden', 'true');
    const host = document.createElement('div'); host.className = 'terminal-host';
    element.append(gutter, host);
    const fitAddon = new FitAddon(); term.loadAddon(fitAddon); term.open(host);
    const s = { ...info, term, fit: fitAddon, element, host, gutter, numberFrame: 0, name: `终端 ${++serial}`, live: true, unread: false };
    sessions.set(s.id, s);
    term.onRender(() => queueLineNumbers(s));
    term.onScroll(() => queueLineNumbers(s));
    term.onResize(() => queueLineNumbers(s));
    term.buffer.onBufferChange(() => queueLineNumbers(s));
    gutter.addEventListener('wheel', event => {
      event.preventDefault();
      const rowHeight = s.host.querySelector('.xterm-screen').getBoundingClientRect().height / term.rows;
      const delta = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * term.rows : event.deltaY / rowHeight;
      s.wheelRemainder = (s.wheelRemainder || 0) + delta;
      const lines = Math.trunc(s.wheelRemainder);
      if (lines) { term.scrollLines(lines); s.wheelRemainder -= lines; }
    }, { passive: false });
    term.onData(data => { if (s.live) window.harbor.input(s.id, data); });
    term.attachCustomKeyEventHandler(event => {
      if (event.metaKey && ['k', ',', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(event.key.toLowerCase())) return false;
      return true;
    });
    activate(s.id); window.harbor.ready(s.id);
  } catch (error) { toast(`终端启动失败：${error.message}`); }
  finally { creating = false; $('new-terminal').disabled = false; }
}
function closeActive() { return closeSession(activeId); }
async function closeSession(id) {
  const s = sessions.get(id);
  if (!s || s.closing) return;
  s.closing = true;
  try {
    if (!await window.harbor.close(s.id)) return;
    const ids = [...sessions.keys()]; const index = ids.indexOf(s.id);
    cancelAnimationFrame(s.numberFrame); s.term.dispose(); s.element.remove(); sessions.delete(s.id);
    if (activeId === s.id) activate(ids[index + 1] || ids[index - 1] || null); else { renderList(); refreshHeader(); }
  } catch (error) { toast(error.message); }
  finally { s.closing = false; }
}
function rename(id = activeId) { const s = sessions.get(id); if (!s) return; renameTarget = id; $('name-input').value = s.name; $('rename-dialog').showModal(); $('name-input').select(); }
function appearance() {
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.dataset.lineNumbers = String(preferences.lineNumbers);
  $('line-numbers-toggle').checked = preferences.lineNumbers;
  $('theme').value = preferences.theme; $('font-size').value = preferences.fontSize;
  try { localStorage.setItem('harbor-appearance', JSON.stringify(preferences)); } catch { toast('外观设置暂时无法保存，请检查磁盘空间。'); }
  for (const s of sessions.values()) { s.term.options.theme = themes[resolvedTheme()]; s.term.options.fontSize = preferences.fontSize; s.gutter.style.fontSize = `${preferences.fontSize}px`; }
  requestAnimationFrame(() => fit(sessions.get(activeId)));
}
function action(type) {
  if (type === 'new') create();
  if (type === 'folder') create(true);
  if (type === 'close') closeActive();
  if (type.startsWith('zoom-')) { preferences.fontSize = type === 'zoom-reset' ? 14 : Math.max(11, Math.min(24, preferences.fontSize + (type === 'zoom-in' ? 1 : -1))); appearance(); }
}
window.harbor.onData(({ id, data }) => { const s = sessions.get(id); if (!s) return; s.term.write(data); if (id !== activeId && !s.unread) { s.unread = true; renderList(); } });
window.harbor.onExit(({ id, exitCode }) => { const s = sessions.get(id); if (!s) return; s.live = false; s.exitCode = exitCode; s.term.write(`\r\n\x1b[90m[进程已结束，退出码 ${exitCode}]\x1b[0m\r\n`); renderList(); refreshHeader(); });
window.harbor.onAction(action);
$('new-terminal').onclick = () => create(); $('empty-create').onclick = () => create(); $('new-folder').onclick = () => create(true);
$('rename').onclick = () => rename(); $('clear').onclick = () => { const s = sessions.get(activeId); s?.term.clear(); s?.term.focus(); }; $('close-terminal').onclick = closeActive;
$('settings-toggle').onclick = () => $('settings').showModal();
$('theme').onchange = event => { preferences.theme = event.target.value; appearance(); };
$('font-size').onchange = event => { preferences.fontSize = Math.max(11, Math.min(24, Number(event.target.value) || 14)); appearance(); };
$('line-numbers-toggle').onchange = event => { preferences.lineNumbers = event.target.checked; appearance(); };
$('rename-cancel').onclick = () => $('rename-dialog').close();
$('rename-form').onsubmit = event => { event.preventDefault(); const name = $('name-input').value.trim(); if (!name) return; const s = sessions.get(renameTarget); if (s) s.name = name; $('rename-dialog').close(); renderList(); refreshHeader(); };
for (const id of ['settings', 'rename-dialog']) $(id).addEventListener('close', () => sessions.get(activeId)?.term.focus());
document.addEventListener('keydown', event => {
  if (!event.metaKey || document.querySelector('dialog[open]')) return;
  if (event.key === 'k') { event.preventDefault(); $('clear').click(); }
  if (event.key === ',') { event.preventDefault(); $('settings').showModal(); }
  if (/^[1-9]$/.test(event.key)) { event.preventDefault(); const id = [...sessions.keys()][Number(event.key) - 1]; if (id) activate(id); }
});
new ResizeObserver(() => fit(sessions.get(activeId))).observe($('terminals'));
appearance(); refreshHeader(); create();
