import { PropsWithChildren } from 'react';

/** Native renders in place; the web version lifts its children to document.body. */
export function Portal({ children }: PropsWithChildren) {
  return <>{children}</>;
}
