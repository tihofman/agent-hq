import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function getAllSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') {
        files.push(...getAllSourceFiles(full));
      }
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      files.push(full);
    }
  }
  return files;
}

describe('import boundaries', () => {
  it('does not import from server modules, bullmq, or ioredis', () => {
    const srcDir = join(__dirname);
    const files = getAllSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);

    const forbiddenPatterns = [
      /from\s+['"][^'"]*\/server(\/|['"])/,
      /from\s+['"][^'"]*bullmq['"]/,
      /from\s+['"][^'"]*ioredis['"]/,
      /from\s+['"]@agent-hq\/queue(?!\/types)['"]/,
    ];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const pattern of forbiddenPatterns) {
        const match = content.match(pattern);
        expect(
          match,
          `File ${file} contains forbidden import matching ${pattern}`,
        ).toBeNull();
      }
    }
  });
});
