import { useEffect, useRef } from 'react';

/** Where the pointer is; a PointerEvent fits. */
export interface Point {
  clientX: number;
  clientY: number;
}

/**
 * A floating copy of the element being dragged that follows the pointer, so it is
 * clear what is being moved while the original marks the slot it will land in.
 * `start` copies the element as it looks now, `move` follows the pointer, `stop`
 * removes the copy (also done if the component unmounts mid-drag).
 */
export function useDragGhost() {
  const ghost = useRef<{ element: HTMLElement; dx: number; dy: number } | null>(null);

  function stop() {
    ghost.current?.element.remove();
    ghost.current = null;
  }

  useEffect(() => stop, []);

  function move(point: Point) {
    if (!ghost.current) return;
    const { element, dx, dy } = ghost.current;
    element.style.transform = `translate(${point.clientX - dx}px, ${point.clientY - dy}px)`;
  }

  function start(source: HTMLElement, point: Point) {
    stop();
    const box = source.getBoundingClientRect();
    const element = source.cloneNode(true) as HTMLElement;
    element.removeAttribute('id');
    element.setAttribute('aria-hidden', 'true');
    element.classList.remove('opacity-50');
    Object.assign(element.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${box.width}px`,
      height: `${box.height}px`,
      margin: '0',
      order: '',
      opacity: '0.85',
      pointerEvents: 'none',
      zIndex: '2000',
      background: 'var(--bs-body-bg, #fff)',
      boxShadow: '0 6px 16px rgba(0, 0, 0, 0.3)',
    });
    document.body.appendChild(element);
    ghost.current = { element, dx: point.clientX - box.left, dy: point.clientY - box.top };
    move(point);
  }

  return { start, move, stop };
}
