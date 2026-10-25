import { render } from 'ink';
import { App } from './app';

export { App };

export function main() {
  return render(<App />);
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
