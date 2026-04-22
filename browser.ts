import Rescue from './index';

if (typeof window !== 'undefined') {
  (window as Window & typeof globalThis & { Rescue?: typeof Rescue }).Rescue = Rescue;
}
