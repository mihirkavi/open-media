// react-dom ships without types and only createPortal is used (Portal.web.tsx).
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactPortal;
}
