import { PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

/**
 * Web: renders into document.body, so a floating card is not clipped or painted over by the
 * stacking contexts react-native-web gives every View.
 */
export function Portal({ children }: PropsWithChildren) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
