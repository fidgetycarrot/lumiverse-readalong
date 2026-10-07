export interface TextIndex { text: string; points: { node: Text; offset: number }[] }
function canon(c: string) { return /\s/.test(c) ? ' ' : c.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase() }
export function normalizeText(text: string) { return Array.from(text).map(canon).join('').replace(/\s+/g, ' ').trim() }
export function locateText(text:string,phrase:string,cursor=0):{offset:number;length:number}|null {
  const exact=normalizeText(phrase);
  // Display-only cue removal can leave a space just inside quotation marks.
  // Match the spoken words when the rendered quote spacing differs.
  const words=exact.replace(/^["'«»\s]+|["'«»\s]+$/g,'');
  let closest:{offset:number;length:number}|null=null;
  for(const needle of exact===words?[exact]:[exact,words]) {
    if(!needle)continue;const offset=text.indexOf(needle,cursor);
    if(offset>=0 && (!closest || offset<closest.offset))closest={offset,length:needle.length};
  }
  return closest;
}
export function indexText(root: Element): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('button,pre,code,script,style,[aria-hidden="true"],[data-ra-ui],[data-spindle-extension-root],[data-spindle-ext]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = ''; const points: TextIndex['points'] = [];
  let lastBlock: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const block = node.parentElement?.closest('p,li,blockquote,h1,h2,h3,h4,h5,h6,td') ?? null;
    if (text && block !== lastBlock && !text.endsWith(' ')) { text += ' '; points.push({ node: node as Text, offset: 0 }); }
    lastBlock = block;
    const value = node.textContent ?? '';
    // UTF-16 offsets are the offsets accepted by DOM Range.
    for (let i = 0; i < value.length; i++) {
      const ch = canon(value[i]);
      if (ch === ' ' && text.endsWith(' ')) continue;
      text += ch; points.push({ node: node as Text, offset: i });
    }
  }
  return { text, points };
}
export function findTextRange(root: Element, phrase: string, cursor = 0): { range: Range; next: number } | null {
  const index = indexText(root), match=locateText(index.text,phrase,cursor);
  // Never jump backward to a repeated sentence when the rendered message changed.
  if (!match) return null;
  const {offset:at,length}=match;
  const a = index.points[at], b = index.points[at + length - 1];
  if (!a || !b) return null;
  const range = document.createRange(); range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset + 1);
  return { range, next: at + length };
}
type HighlightWindow = Window & typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown };
export class PassageMarker {
  private ranges: Range[] = [];
  private overlay = document.createElement('div');
  private frame = 0;
  private getRoot: (() => Element | null) | null = null;
  private text = '';
  private cursor = 0;
  private start = 0;
  private disposed = false;
  private refreshAt = 0;
  constructor(private onVisible?: (visible: boolean) => void) {
    this.overlay.className = 'ra-marker-overlay'; this.overlay.dataset.raUi = 'true'; this.overlay.setAttribute('aria-hidden','true');
    document.body.appendChild(this.overlay);
  }
  reset() { this.clear(); this.cursor = 0; this.start = 0 }
  mark(getRoot: () => Element | null, text: string) {
    this.getRoot = getRoot; this.text = text; this.start = this.cursor;
    const found = this.refresh(); if (found) this.cursor = found.next;
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    if (this.disposed || !this.getRoot) { this.frame = 0; return }
    if (now - this.refreshAt > 250) { this.refresh(); this.refreshAt = now }
    this.frame = requestAnimationFrame(this.tick);
  };
  private refresh() {
    const root = this.getRoot?.(); const found = root ? findTextRange(root, this.text, this.start) : null;
    const css = CSS as typeof CSS & { highlights?: Map<string, unknown> };
    this.overlay.replaceChildren(); this.ranges = found ? [found.range] : [];
    const Highlight = (window as HighlightWindow).Highlight;
    if (css.highlights && Highlight) {
      css.highlights.delete('lumiverse-readalong');
      if (found) css.highlights.set('lumiverse-readalong', new Highlight(found.range));
    } else if (found) {
      for (const rect of found.range.getClientRects()) {
        const block = document.createElement('div');
        block.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(245,190,80,.26);border-bottom:2px solid #e7b24c;border-radius:3px;pointer-events:none;`;
        this.overlay.appendChild(block);
      }
    }
    this.onVisible?.(!!found); return found;
  }
  follow() {
    const range = this.ranges[0]; if (!range) return;
    const rect = range.getBoundingClientRect();
    if (rect.top < 100 || rect.bottom > window.innerHeight - 130) range.startContainer.parentElement?.scrollIntoView({ block:'center', behavior:'smooth' });
  }
  clear() {
    this.getRoot = null; this.text = ''; this.ranges = []; this.overlay.replaceChildren();
    (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights?.delete('lumiverse-readalong');
    cancelAnimationFrame(this.frame); this.frame = 0;
  }
  dispose() { this.disposed = true; this.clear(); this.overlay.remove() }
}
