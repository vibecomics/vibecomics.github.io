import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * A ref to put on an element, and whether it has been on screen yet (it stays true afterwards).
 * Without IntersectionObserver the element counts as seen at once.
 */
export function useSeen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);

  return [ref, seen];
}
