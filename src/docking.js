import layoutTools from './layout.cjs';
const { leaves, remove, replace, normalize } = layoutTools;
export class Docking {
  constructor({ root, sessions, onSelect, onChange, onResize, onNotice }) {
    Object.assign(this, { root, sessions, onSelect, onChange, onResize, onNotice });
    this.layout = null; this.dragId = null;
    this.canvas = document.createElement('div'); this.canvas.className = 'dock-canvas'; root.append(this.canvas);
    document.addEventListener('dragend', () => this.endDrag());
    window.addEventListener('blur', () => this.endDrag());
    document.addEventListener('dragover', event => { if (this.dragId && !event.target.closest('.dock-hit')) this.clearPreview(); });
  }
  visible(id) { return leaves(this.previewLayout || this.layout).includes(id); }
  startDrag(event, id) {
    this.endDrag();
    this.dragId = id; event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-cairn-session', id);
    document.body.classList.add('session-dragging');
    // Keep the original hit regions stable while the real terminal panes move.
    // Native drag sources must stay attached to their original DOM parents.
    this.baseRects = new Map(); this.hitLayer = document.createElement('div'); this.hitLayer.className = 'dock-hit-layer';
    for (const slot of this.canvas.querySelectorAll('.dock-slot')) {
      const target = slot.dataset.id, rect = slot.getBoundingClientRect(); this.baseRects.set(target, rect);
      if (target === id) continue;
      const hit = document.createElement('div'); hit.className = 'dock-hit'; hit.dataset.id = target;
      Object.assign(hit.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      hit.ondragover = e => {
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
        if (this.dragId === target) { this.clearPreview(); return; }
        const x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
        const distances = [['left', x], ['right', 1-x], ['top', y], ['bottom', 1-y]].sort((a,b)=>a[1]-b[1]);
        const edge = distances[0][1] < .25 ? distances[0][0] : '';
        hit.dataset.dropEdge = edge;
        e.dataTransfer.dropEffect = edge ? 'move' : 'none';
        this.preview(target, edge);
      };
      hit.ondrop = e => { e.preventDefault(); e.stopPropagation(); this.drop(this.dragId, target, hit.dataset.dropEdge); };
      this.hitLayer.append(hit);
    }
    this.root.append(this.hitLayer);
  }
  captureRects() {
    const rects = new Map();
    for (const s of this.sessions.values()) {
      if (s.element.hidden) continue;
      const slot = this.canvas.querySelector(`.dock-slot[data-id="${s.id}"]`);
      const element = slot || s.element;
      if (element.style.visibility !== 'hidden') rects.set(s.id, element.getBoundingClientRect());
    }
    return rects;
  }
  cancelMotion() {
    for (const animation of this.motion || []) animation.cancel();
    this.motion = [];
  }
  animateLayout(from) {
    this.cancelMotion();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const options = { duration: reduced ? 0 : 460, easing: 'cubic-bezier(0.22, 0.8, 0.25, 1)' };
    for (const s of this.sessions.values()) {
      if (s.element.hidden) continue;
      const element = this.canvas.querySelector(`.dock-slot[data-id="${s.id}"]`) || s.element;
      if (element.style.visibility === 'hidden') continue;
      const to = element.getBoundingClientRect(), old = from.get(s.id);
      if (!to.width || !to.height) continue;
      const frames = old && old.width && old.height
        ? [{ transform: `translate(${old.left-to.left}px, ${old.top-to.top}px) scale(${old.width/to.width}, ${old.height/to.height})` }, { transform: 'none' }]
        : [{ opacity: .1, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }];
      const animation = element.animate(frames, options); this.motion.push(animation);
      animation.onfinish = () => requestAnimationFrame(this.onResize);
    }
  }
  clearPreview(animate = true) {
    if (!this.previewLayout) return;
    const from = animate ? this.captureRects() : null; this.cancelMotion();
    this.previewLayout = null; this.previewKey = null;
    this.placeholder?.remove(); this.placeholder = null;
    for (const slot of this.canvas.querySelectorAll('.dock-slot')) slot.removeAttribute('style');
    for (const s of this.sessions.values()) {
      s.element.removeAttribute('style'); s.element.hidden = !leaves(this.layout).includes(s.id);
    }
    this.root.classList.remove('live-dock-preview');
    this.root.classList.toggle('is-split', leaves(this.layout).length > 1);
    this.root.querySelectorAll('.preview-separator').forEach(el=>el.remove());
    if (animate) this.animateLayout(from);
    requestAnimationFrame(this.onResize);
  }
  preview(target, edge) {
    if (!['left', 'right', 'top', 'bottom'].includes(edge)) { this.clearPreview(); return; }
    const key = `${target}:${edge}`; if (key === this.previewKey) return;
    const from = this.captureRects();
    const previousPlaceholder = this.placeholder?.getBoundingClientRect();
    this.clearPreview(false);
    const rect = this.baseRects.get(target);
    if (['left','right'].includes(edge) ? rect.width < 320 : rect.height < 220) return;
    this.previewLayout = this.proposedLayout(this.dragId, target, edge); this.previewKey = key;
    this.root.classList.add('live-dock-preview');
    this.root.classList.toggle('is-split', leaves(this.previewLayout).length > 1);
    const placements = new Map();
    const position = (node, box) => {
      if ('id' in node) { placements.set(node.id, box); return; }
      const horizontal = node.axis === 'horizontal';
      const firstSize = ((horizontal ? box.width : box.height) - 7) * node.ratio;
      const first = { ...box, [horizontal ? 'width' : 'height']: firstSize };
      const second = { ...box, [horizontal ? 'left' : 'top']: (horizontal ? box.left : box.top) + firstSize + 7, [horizontal ? 'width' : 'height']: (horizontal ? box.width : box.height) - firstSize - 7 };
      const line = document.createElement('div'); line.className = 'preview-separator';
      Object.assign(line.style, { left: `${horizontal ? box.left + firstSize : box.left}px`, top: `${horizontal ? box.top : box.top + firstSize}px`, width: `${horizontal ? 7 : box.width}px`, height: `${horizontal ? box.height : 7}px` });
      this.root.append(line); position(node.first, first); position(node.second, second);
    };
    const rootRect = this.canvas.getBoundingClientRect();
    position(this.previewLayout, { left: rootRect.left, top: rootRect.top, width: rootRect.width, height: rootRect.height });
    for (const s of this.sessions.values()) {
      const box = placements.get(s.id), slot = this.canvas.querySelector(`.dock-slot[data-id="${s.id}"]`);
      if (slot) {
        slot.style.visibility = box ? 'visible' : 'hidden';
        if (box) Object.assign(slot.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, zIndex: '30' });
      } else if (box) {
        s.element.hidden = false;
        Object.assign(s.element.style, { position: 'fixed', inset: 'auto', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, zIndex: '30' });
      }
    }
    const placement = placements.get(this.dragId);
    if (placement) {
      const placeholder = document.createElement('div'); placeholder.className = 'snap-placeholder';
      const icon = document.createElement('span'); icon.className = 'snap-window-icon'; icon.setAttribute('aria-hidden','true');
      const label = document.createElement('span'); label.textContent = '松手放置';
      const name = document.createElement('strong'); name.textContent = this.sessions.get(this.dragId).name;
      placeholder.append(icon, name, label);
      Object.assign(placeholder.style, { left: `${placement.left+5}px`, top: `${placement.top+5}px`, width: `${Math.max(0,placement.width-10)}px`, height: `${Math.max(0,placement.height-10)}px` });
      this.root.append(placeholder); this.placeholder = placeholder;
      const options = { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 460, easing: 'cubic-bezier(0.22, 0.8, 0.25, 1)' };
      placeholder.animate(previousPlaceholder ? [
        { opacity: .7, transform: `translate(${previousPlaceholder.left-placement.left-5}px, ${previousPlaceholder.top-placement.top-5}px) scale(${previousPlaceholder.width/(placement.width-10)}, ${previousPlaceholder.height/(placement.height-10)})` },
        { opacity: 1, transform: 'none' }
      ] : [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }], options);
    }
    this.animateLayout(from);
    requestAnimationFrame(this.onResize);
  }
  endDrag() {
    this.clearPreview(); this.hitLayer?.remove(); this.hitLayer = null; this.baseRects = null;
    this.dragId = null; document.body.classList.remove('session-dragging');
    document.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  }
  select(id) {
    const visible = this.visible(id);
    if (!visible) this.layout = this.layout ? replace(this.layout, this.activeId, { id }) : { id };
    this.activeId = id;
    if (!visible) this.render();
    else {
      for (const s of this.sessions.values()) s.element.classList.toggle('focused-pane', s.id === id);
      this.onChange();
    }
  }
  restore(layout, activeId) {
    this.layout = normalize(layout, [...this.sessions.keys()]); this.activeId = activeId;
    if (activeId && !this.visible(activeId)) this.layout = this.layout ? replace(this.layout, leaves(this.layout)[0], { id: activeId }) : { id: activeId };
    this.render();
  }
  hide(id) {
    this.layout = remove(this.layout, id);
    const next = leaves(this.layout)[0] || id;
    if (!this.layout && this.sessions.has(id)) this.layout = { id };
    this.render(); this.onSelect(next);
  }
  only(id) { this.layout = { id }; this.render(); this.onSelect(id); }
  focusDirection(direction) {
    const current = this.canvas.querySelector(`.dock-slot[data-id="${this.activeId}"]`)?.getBoundingClientRect();
    if (!current) return;
    const horizontal = ['left', 'right'].includes(direction);
    const center = rect => horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    const cross = rect => horizontal ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    const sign = ['left', 'up'].includes(direction) ? -1 : 1;
    const candidates = [...this.canvas.querySelectorAll('.dock-slot')]
      .filter(slot => slot.dataset.id !== this.activeId)
      .map(slot => {
        const rect = slot.getBoundingClientRect();
        const distance = (center(rect) - center(current)) * sign;
        const overlap = horizontal
          ? Math.min(rect.bottom, current.bottom) - Math.max(rect.top, current.top)
          : Math.min(rect.right, current.right) - Math.max(rect.left, current.left);
        return { id: slot.dataset.id, distance, overlap, offset: Math.abs(cross(rect) - cross(current)) };
      }).filter(candidate => candidate.distance > 1)
      .sort((a, b) => Number(b.overlap > 0) - Number(a.overlap > 0) || (a.distance + a.offset) - (b.distance + b.offset));
    if (candidates[0]) this.onSelect(candidates[0].id);
  }
  proposedLayout(id, target, edge) {
    if (!['left', 'right', 'top', 'bottom'].includes(edge)) return this.layout;
    let layout = remove(this.layout, id);
    const before = edge === 'left' || edge === 'top';
    layout = replace(layout, target, { axis: ['left', 'right'].includes(edge) ? 'horizontal' : 'vertical', ratio: .5, first: before ? { id } : { id: target }, second: before ? { id: target } : { id } });
    return layout;
  }
  drop(id, target, edge) {
    if (!['left', 'right', 'top', 'bottom'].includes(edge) || !this.sessions.has(id) || id === target) { this.endDrag(); return; }
    const rect = this.baseRects?.get(target) || this.canvas.querySelector(`.dock-slot[data-id="${target}"]`)?.getBoundingClientRect();
    if (rect && (['left','right'].includes(edge) ? rect.width < 320 : rect.height < 220)) {
      this.endDrag(); this.onNotice('当前区域太小，请先扩大窗口或调整分隔线。'); return;
    }
    const layout = this.proposedLayout(id, target, edge);
    const from = this.captureRects();
    this.endDrag(); this.layout = layout; this.render(); this.onSelect(id);
    this.animateLayout(from);
  }
  render() {
    const visible = leaves(this.layout); const split = visible.length > 1;
    this.root.classList.toggle('is-split', split);
    for (const s of this.sessions.values()) {
      s.element.hidden = !visible.includes(s.id);
      if (visible.includes(s.id)) s.unread = false;
      s.element.classList.toggle('focused-pane', s.id === this.activeId);
      s.paneTitle.textContent = s.name; s.paneTitle.title = `${s.name} · ${s.cwd}`;
      if (!visible.includes(s.id)) this.root.append(s.element);
    }
    const build = node => {
      if ('id' in node) {
        const slot = document.createElement('div'); slot.className = 'dock-slot'; slot.dataset.id = node.id;
        slot.append(this.sessions.get(node.id).element);
        return slot;
      }
      const branch = document.createElement('div'); branch.className = `dock-branch ${node.axis}`;
      const first = build(node.first), second = build(node.second);
      const separator = document.createElement('div'); separator.className = 'dock-separator'; separator.tabIndex = 0;
      separator.setAttribute('role','separator'); separator.setAttribute('aria-label','调整分屏大小');
      separator.setAttribute('aria-orientation',node.axis === 'horizontal' ? 'vertical' : 'horizontal');
      const size = () => {
        branch.style[node.axis === 'horizontal' ? 'gridTemplateColumns' : 'gridTemplateRows'] = `minmax(0, ${node.ratio}fr) 7px minmax(0, ${1-node.ratio}fr)`;
        separator.setAttribute('aria-valuenow',Math.round(node.ratio*100));
      }; size();
      let frame;
      const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(this.onResize); };
      separator.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); separator.setPointerCapture(event.pointerId); document.body.classList.add('resizing-panes'); };
      separator.onpointermove = event => {
        if (!separator.hasPointerCapture(event.pointerId)) return;
        const rect = branch.getBoundingClientRect();
        const extent = node.axis === 'horizontal' ? rect.width : rect.height;
        const position = node.axis === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top;
        const minimum = Math.min(.4, (node.axis === 'horizontal' ? 160 : 110) / extent);
        node.ratio = Math.max(minimum, Math.min(1-minimum, position / extent)); size(); resize();
      };
      const finish = () => { document.body.classList.remove('resizing-panes'); this.onChange(); };
      separator.onpointerup = event => { if (separator.hasPointerCapture(event.pointerId)) separator.releasePointerCapture(event.pointerId); finish(); };
      separator.onlostpointercapture = finish;
      separator.onkeydown = event => {
        const keys = node.axis === 'horizontal' ? ['ArrowLeft','ArrowRight'] : ['ArrowUp','ArrowDown'];
        if (!keys.includes(event.key)) return;
        event.preventDefault(); node.ratio = Math.max(.15, Math.min(.85,node.ratio+(event.key===keys[0]?-.05:.05))); size(); resize(); this.onChange();
      };
      branch.append(first, separator, second); return branch;
    };
    const tree = this.layout ? build(this.layout) : null;
    this.canvas.replaceChildren(...(tree ? [tree] : []));
    requestAnimationFrame(this.onResize); this.onChange();
  }
}
