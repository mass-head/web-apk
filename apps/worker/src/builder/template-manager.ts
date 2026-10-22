import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TemplateManager {
  private templateRoot: string;

  constructor() {
    this.templateRoot = this.findTemplateRoot();
  }

  private findTemplateRoot(): string {
    const candidates = [
      process.env.ANDROID_TEMPLATE_DIR,
      '/opt/android-template',
      path.resolve(process.cwd(), 'packages/android-template'),
      path.resolve(__dirname, '../../../../packages/android-template'),
      path.resolve(__dirname, '../../../packages/android-template'),
    ].filter((c): c is string => typeof c === 'string' && fs.existsSync(c));

    for (const cand of candidates) {
      if (fs.existsSync(path.join(cand, 'app/build.gradle.kts'))) {
        return cand;
      }
    }

    throw new Error('Trusted Android template directory could not be located.');
  }

  getTemplateRoot(): string {
    return this.templateRoot;
  }

  copyTemplateTo(destination: string): void {
    this.copyDirectoryRecursive(this.templateRoot, destination);
  }

  private copyDirectoryRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      // Security: Strip out any build artifacts, caches, git or node files
      if (
        entry.name === 'build' ||
        entry.name === '.gradle' ||
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'test'
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        this.copyDirectoryRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

export const templateManager = new TemplateManager();
