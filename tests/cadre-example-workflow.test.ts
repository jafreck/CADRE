import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(__dirname, '../.github/workflows/cadre-example.yml');
let content: string;

beforeAll(() => {
  content = readFileSync(workflowPath, 'utf8');
});

describe('cadre-example.yml workflow file', () => {
  describe('file existence', () => {
    it('should exist at .github/workflows/cadre-example.yml', () => {
      expect(() => readFileSync(workflowPath, 'utf8')).not.toThrow();
    });
  });

  describe('triggers', () => {
    it('should include a schedule (cron) trigger', () => {
      expect(content).toMatch(/schedule:/);
      expect(content).toMatch(/cron:/);
    });

    it('should include a workflow_dispatch trigger', () => {
      expect(content).toMatch(/workflow_dispatch:/);
    });

    it('should include an optional issue_ids input in workflow_dispatch', () => {
      expect(content).toMatch(/issue_ids/);
    });

    it('should include issues labeled trigger', () => {
      expect(content).toMatch(/issues:/);
      expect(content).toMatch(/types:\s*\[labeled\]/);
    });
  });

  describe('checkout step', () => {
    it('should use fetch-depth: 0', () => {
      expect(content).toMatch(/fetch-depth:\s*0/);
    });
  });

  describe('Node.js setup', () => {
    it('should set up Node.js via actions/setup-node', () => {
      expect(content).toMatch(/actions\/setup-node/);
    });

    it('should use Node.js version 20', () => {
      expect(content).toMatch(/node-version:\s*["']?20["']?/);
    });
  });

  describe('CADRE installation and invocation', () => {
    it('should install cadre', () => {
      expect(content).toMatch(/cadre/);
      expect(content).toMatch(/npm install/);
    });

    it('should invoke cadre run', () => {
      expect(content).toMatch(/cadre run/);
    });

    it('should set repoPath to github.workspace', () => {
      expect(content).toMatch(/github\.workspace/);
    });
  });

  describe('PAT token auth variant', () => {
    it('should include GITHUB_TOKEN reference', () => {
      expect(content).toMatch(/GITHUB_TOKEN/);
    });

    it('should reference secrets.GITHUB_TOKEN', () => {
      expect(content).toMatch(/secrets\.GITHUB_TOKEN/);
    });
  });

  describe('GitHub App auth variant', () => {
    it('should include APP_ID secret reference', () => {
      expect(content).toMatch(/APP_ID/);
    });

    it('should include INSTALLATION_ID secret reference', () => {
      expect(content).toMatch(/INSTALLATION_ID/);
    });

    it('should include PRIVATE_KEY secret reference', () => {
      expect(content).toMatch(/PRIVATE_KEY/);
    });
  });

  describe('GitHub App permissions documentation', () => {
    it('should document Issues: read permission', () => {
      expect(content).toMatch(/Issues.*read/i);
    });

    it('should document Pull Requests: write permission', () => {
      expect(content).toMatch(/Pull Requests.*write/i);
    });

    it('should document Contents: write permission', () => {
      expect(content).toMatch(/Contents.*write/i);
    });
  });
});
