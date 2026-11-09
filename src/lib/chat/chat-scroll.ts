import { tick } from 'svelte';
import { historyJumpVisible } from './chat-search';
type Position = { peer: string; lastId: string; openToken: number };
// Shared viewport behavior; has no access to transport, storage or receipts.
export function createChatScroll(options: { activePeer(): string; firstUnread(peer: string): string | undefined; onJump(visible: boolean): void }) {
  return (node: HTMLElement, initial: Position) => {
    let current = initial, atBottom = true, alive = true, messageNodes: HTMLElement[] = [];
    const updateBottom = () => {
      atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 24;
      options.onJump(historyJumpVisible(messageNodes.length, messageNodes.at(-12)?.getBoundingClientRect().bottom, node.getBoundingClientRect().bottom));
    };
    const positionOnOpen = async (peer: string) => {
      await tick(); if (!alive || current.peer !== peer || options.activePeer() !== peer) return;
      const first = options.firstUnread(peer), target = [...node.querySelectorAll<HTMLElement>('[data-chat-message-id]')].find(element => element.dataset.chatMessageId === first);
      if (target) node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top - 10;
      else node.scrollTop = node.scrollHeight;
      updateBottom();
    };
    node.addEventListener('scroll', updateBottom, { passive: true });
    const resize = new ResizeObserver(() => { if (atBottom) node.scrollTop = node.scrollHeight; updateBottom(); });
    resize.observe(node);
    const observeChildren = () => {
      const next = [...node.querySelectorAll<HTMLElement>('[data-chat-message-id]')], present = new Set(next);
      for (const old of messageNodes) if (!present.has(old)) resize.unobserve(old);
      messageNodes = next; for (const child of node.children) resize.observe(child);
    };
    observeChildren(); const mutation = new MutationObserver(observeChildren); mutation.observe(node, { childList: true });
    void positionOnOpen(current.peer);
    return {
      update(next: Position) {
        if (next.peer !== current.peer || next.openToken !== current.openToken) { current = next; void positionOnOpen(next.peer); }
        else if (next.lastId !== current.lastId) { current = next; if (atBottom) void tick().then(() => {
          if (!alive || options.activePeer() !== next.peer || current.lastId !== next.lastId) return;
          node.scrollTop = node.scrollHeight; updateBottom();
        }); } else current = next;
      },
      destroy() { alive = false; resize.disconnect(); mutation.disconnect(); options.onJump(false); node.removeEventListener('scroll', updateBottom); }
    };
  };
}
