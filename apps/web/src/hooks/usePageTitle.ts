import { useEffect } from "react";
import { PRODUCT_NAME } from "../brand.ts";

// Each page names itself in the tab and for screen readers ("Sessions · Builder"), so pages can be told apart.
export function pageTitle(title?: string): string {
  return title ? `${title} · ${PRODUCT_NAME}` : PRODUCT_NAME;
}

export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}
