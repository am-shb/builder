import { useEffect, useRef, useState, type RefObject } from "react";

// Whether an element is on screen. With `once`, it stays true after the first time (scroll reveals). Without an
// IntersectionObserver (old browsers, tests), everything counts as on screen, so nothing stays hidden.
export function useInView<T extends Element>(options: { once?: boolean; rootMargin?: string; threshold?: number } = {}): [RefObject<T | null>, boolean] {
  const { once = false, rootMargin = "0px", threshold = 0 } = options;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setInView(entry.isIntersecting);
      if (entry.isIntersecting && once) io.disconnect();
    }, { rootMargin, threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [once, rootMargin, threshold]);
  return [ref, inView];
}
