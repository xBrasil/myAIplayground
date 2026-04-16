import { APP_VERSION } from '../app-info';

export function isDevMode(): boolean {
  return APP_VERSION.trimEnd().endsWith('(dev)');
}
