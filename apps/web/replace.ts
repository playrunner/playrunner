import * as fs from 'fs';
import * as path from 'path';

function replaceInDir(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      replaceInDir(fullPath);
    } else if (stat.isFile() && (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts') || fullPath.endsWith('.jsx') || fullPath.endsWith('.js'))) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const newContent = content.replace(/text-white/g, 'text-[var(--foreground)]');
      if (content !== newContent) {
        fs.writeFileSync(fullPath, newContent, 'utf-8');
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

replaceInDir(path.resolve('./src'));
