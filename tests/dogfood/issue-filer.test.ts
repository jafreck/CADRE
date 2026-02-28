import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DogfoodIssueFiler } from '../../src/dogfood/issue-filer.js';
import type { DogfoodTopic, TopicKey, SeverityLevel } from '../../src/dogfood/types.js';
import type { Logger } from '../../src/logging/logger.js';
import type { PlatformProvider } from '../../src/platform/provider.js';

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makePlatform(): PlatformProvider {
  return {
    createIssue: vi.fn().mockResolvedValue(1),
  } as unknown as PlatformProvider;
}

function makeTopicKey(overrides: Partial<TopicKey> = {}): TopicKey {
  return {
    subsystem: 'parser',
    failureMode: 'timeout',
    impactScope: 'global',
    ...overrides,
  };
}

function makeTopic(overrides: Partial<DogfoodTopic> = {}): DogfoodTopic {
  return {
    key: makeTopicKey(),
    signals: [
      {
        subsystem: 'parser',
        failureMode: 'timeout',
        message: 'timed out after 30s',
        timestamp: '2026-01-01T00:00:00Z',
        impactScope: 'global',
      },
    ],
    severity: 'high' as SeverityLevel,
    mergedCount: 3,
    affectedIssues: [10, 20],
    firstSeen: '2026-01-01T00:00:00Z',
    lastSeen: '2026-01-03T00:00:00Z',
    ...overrides,
  };
}

describe('DogfoodIssueFiler', () => {
  let logger: Logger;
  let platform: PlatformProvider;
  let filer: DogfoodIssueFiler;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    platform = makePlatform();
    filer = new DogfoodIssueFiler(platform, logger);
  });

  describe('file', () => {
    it('should return an empty array when given no topics', async () => {
      const result = await filer.file([]);
      expect(result).toEqual([]);
    });

    it('should file one issue per topic', async () => {
      const topic = makeTopic();
      const result = await filer.file([topic]);

      expect(result).toHaveLength(1);
      expect(result[0].topicKey).toEqual(topic.key);
      expect(result[0].severity).toBe('high');
      expect(result[0].title).toContain('parser');
      expect(result[0].title).toContain('timeout');
    });

    it('should include correct labels', async () => {
      const topic = makeTopic();
      const result = await filer.file([topic]);

      expect(result[0].labels).toContain('dogfood');
      expect(result[0].labels).toContain('severity:high');
      expect(result[0].labels).toContain('subsystem:parser');
    });

    it('should include aggregation evidence in the body', async () => {
      const topic = makeTopic({ mergedCount: 5, affectedIssues: [1, 2, 3] });
      const result = await filer.file([topic]);

      expect(result[0].body).toContain('5');
      expect(result[0].body).toContain('#1');
      expect(result[0].body).toContain('#2');
      expect(result[0].body).toContain('#3');
    });

    it('should include severity and priority in the body', async () => {
      const topic = makeTopic({ severity: 'critical' });
      const result = await filer.file([topic]);

      expect(result[0].body).toContain('critical');
      expect(result[0].priority).toBe(5); // SEVERITY_ORDER['critical']
    });

    it('should include sample messages in the body', async () => {
      const topic = makeTopic({
        signals: [
          { subsystem: 'a', failureMode: 'b', message: 'first error', timestamp: 't' },
          { subsystem: 'a', failureMode: 'b', message: 'second error', timestamp: 't' },
        ],
      });
      const result = await filer.file([topic]);

      expect(result[0].body).toContain('first error');
      expect(result[0].body).toContain('second error');
    });

    it('should limit sample messages to 5', async () => {
      const signals = Array.from({ length: 8 }, (_, i) => ({
        subsystem: 'a',
        failureMode: 'b',
        message: `error ${i}`,
        timestamp: 't',
      }));
      const topic = makeTopic({ signals });
      const result = await filer.file([topic]);

      // Should contain first 5 but not the 6th
      expect(result[0].body).toContain('error 4');
      expect(result[0].body).not.toContain('error 5');
    });

    it('should skip duplicate topic keys and log', async () => {
      const key = makeTopicKey();
      const t1 = makeTopic({ key });
      const t2 = makeTopic({ key });
      const result = await filer.file([t1, t2]);

      expect(result).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Skipping duplicate'),
      );
    });

    it('should file different topics with different keys', async () => {
      const t1 = makeTopic({ key: makeTopicKey({ subsystem: 'parser' }) });
      const t2 = makeTopic({ key: makeTopicKey({ subsystem: 'renderer' }) });
      const result = await filer.file([t1, t2]);

      expect(result).toHaveLength(2);
    });

    it('should log info for each successfully filed issue', async () => {
      const topic = makeTopic();
      await filer.file([topic]);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Filed issue for topic'),
      );
    });

    it('should show "none" for affected issues when there are none', async () => {
      const topic = makeTopic({ affectedIssues: [] });
      const result = await filer.file([topic]);

      expect(result[0].body).toContain('none');
    });

    it('should include reproducibility hints in the body', async () => {
      const topic = makeTopic();
      const result = await filer.file([topic]);

      expect(result[0].body).toContain('Reproducibility');
      expect(result[0].body).toContain('parser');
      expect(result[0].body).toContain('timeout');
      expect(result[0].body).toContain('global');
    });

    it('should include expected vs actual in the body', async () => {
      const topic = makeTopic();
      const result = await filer.file([topic]);

      expect(result[0].body).toContain('Expected');
      expect(result[0].body).toContain('Actual');
    });
  });
});
