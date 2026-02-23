import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackProvider } from '../src/notifications/slack-provider.js';
import type { CadreEvent } from '../src/notifications/types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function okResponse(): Response {
  return { ok: true, status: 200 } as Response;
}

describe('SlackProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(okResponse());
  });

  afterEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it('should POST to the configured webhookUrl', async () => {
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should send a payload with a blocks array', async () => {
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('should include a header block with event type', async () => {
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    const event: CadreEvent = { type: 'issue-started', issueNumber: 42, issueTitle: 'Fix bug', worktreePath: '/tmp/wt' };
    await provider.notify(event);
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const headerBlock = body.blocks[0];
    expect(headerBlock.type).toBe('header');
    expect(headerBlock.text.text).toBe('issue-started');
  });

  it('should include a section block with event fields as mrkdwn', async () => {
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    const event: CadreEvent = { type: 'issue-started', issueNumber: 42, issueTitle: 'Fix bug', worktreePath: '/tmp/wt' };
    await provider.notify(event);
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const sectionBlock = body.blocks[1];
    expect(sectionBlock.type).toBe('section');
    expect(sectionBlock.text.type).toBe('mrkdwn');
    expect(sectionBlock.text.text).toContain('*issueNumber:*');
    expect(sectionBlock.text.text).toContain('*issueTitle:*');
  });

  it('should not include a section block when event has only type field', async () => {
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    const event = { type: 'fleet-started' } as unknown as CadreEvent;
    await provider.notify(event);
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.blocks).toHaveLength(1);
  });

  it('should include channel in payload when configured', async () => {
    const provider = new SlackProvider({
      webhookUrl: 'https://hooks.slack.com/test',
      channel: '#deployments',
    });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.channel).toBe('#deployments');
  });

  it('should not include channel in payload when not configured', async () => {
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty('channel');
  });

  it('should resolve ${ENV_VAR} in webhookUrl', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/resolved';
    const provider = new SlackProvider({ webhookUrl: '${SLACK_WEBHOOK_URL}' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    expect(mockFetch).toHaveBeenCalledWith('https://hooks.slack.com/resolved', expect.anything());
  });

  it('should skip events not in events filter', async () => {
    const provider = new SlackProvider({
      webhookUrl: 'https://hooks.slack.com/test',
      events: ['fleet-completed'],
    });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should send events matching the events filter', async () => {
    const provider = new SlackProvider({
      webhookUrl: 'https://hooks.slack.com/test',
      events: ['fleet-started'],
    });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should send all events when no filter is configured', async () => {
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    await provider.notify({ type: 'fleet-completed', success: true, prsCreated: 0, failedIssues: 0, totalDuration: 10, totalTokens: 100 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should not throw on HTTP error response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    await expect(provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 })).resolves.toBeUndefined();
  });

  it('should not throw when fetch rejects (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    await expect(provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 })).resolves.toBeUndefined();
  });

  it('should send Content-Type application/json', async () => {
    const provider = new SlackProvider({ webhookUrl: 'https://hooks.slack.com/test' });
    await provider.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
    const [, init] = mockFetch.mock.calls[0];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
