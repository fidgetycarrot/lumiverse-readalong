/** Keep live controls connected while the clock, marker and preparation update. */
export function patchPlaybackChildren(parent:Element,...children:Node[]) {
  const patch=(old:Node,next:Node):Node=>{
    if(old.nodeType!==next.nodeType)return next;
    if(old instanceof HTMLElement && next instanceof HTMLElement) {
      if(old.tagName!==next.tagName || old.dataset.raControl!==next.dataset.raControl)return next;
      for(const attr of [...old.attributes])if(!next.hasAttribute(attr.name))old.removeAttribute(attr.name);
      for(const attr of [...next.attributes])if(old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value);
      old.onclick=next.onclick;old.oninput=next.oninput;old.onchange=next.onchange;
      if(old instanceof HTMLButtonElement && next instanceof HTMLButtonElement)old.disabled=next.disabled;
      if(old instanceof HTMLInputElement && next instanceof HTMLInputElement){old.checked=next.checked;if(old.value!==next.value)old.value=next.value}
      sync(old,[...next.childNodes]);
      if(old instanceof HTMLSelectElement && next instanceof HTMLSelectElement)old.value=next.value;
      return old;
    }
    if(old.nodeType===Node.TEXT_NODE){if(old.textContent!==next.textContent)old.textContent=next.textContent;return old}
    return next;
  };
  const sync=(target:Element,nodes:Node[])=>{
    nodes.forEach((node,i)=>{
      const old=target.childNodes[i],replacement=old?patch(old,node):node;
      if(old!==replacement){if(old)target.replaceChild(replacement,old);else target.appendChild(replacement)}
    });
    while(target.childNodes.length>nodes.length)target.lastChild!.remove();
  };
  sync(parent,children);
}
