import type { FrameworkBoundaryEvent } from './events.js';

export interface EventDispatcher {
  dispatch(event: FrameworkBoundaryEvent): Promise<void>;
}

export interface ProgressEventAppender {
  appendEvent(message: string): Promise<void>;
}

export interface EventBusMiddlewareContext {
  event: FrameworkBoundaryEvent;
}

export interface EventBusMiddlewareHooks {
  beforeDispatch?(context: EventBusMiddlewareContext): Promise<void> | void;
  afterDispatch?(context: EventBusMiddlewareContext): Promise<void> | void;
  onDispatchError?(context: EventBusMiddlewareContext, error: unknown): Promise<void> | void;
}

export type EventBusMiddleware = EventBusMiddlewareHooks | ((
  context: EventBusMiddlewareContext,
  next: () => Promise<void>,
) => Promise<void> | void);

/**
 * Dispatches fleet-level lifecycle and budget events.
 */
export class FleetEventBus {
  private readonly middleware: EventBusMiddleware[];

  constructor(
    private readonly notifications: EventDispatcher,
    private readonly fleetProgress: ProgressEventAppender,
    middleware: EventBusMiddleware[] = [],
  ) {
    this.middleware = [...middleware];
  }

  use(middleware: EventBusMiddleware): void {
    this.middleware.push(middleware);
  }

  clearMiddleware(): void {
    this.middleware.length = 0;
  }

  private async runMiddleware(context: EventBusMiddlewareContext, dispatch: () => Promise<void>): Promise<void> {
    const stack = this.middleware;
    let index = -1;

    const invoke = async (currentIndex: number): Promise<void> => {
      if (currentIndex <= index) {
        throw new Error('Event bus middleware called next() multiple times');
      }
      index = currentIndex;
      const item = stack[currentIndex];
      if (!item) {
        await dispatch();
        return;
      }

      if (typeof item === 'function') {
        await item(context, async () => invoke(currentIndex + 1));
        return;
      }

      await item.beforeDispatch?.(context);
      try {
        await invoke(currentIndex + 1);
        await item.afterDispatch?.(context);
      } catch (error) {
        await item.onDispatchError?.(context, error);
        throw error;
      }
    };

    await invoke(0);
  }

  private async dispatchEvent(event: FrameworkBoundaryEvent): Promise<void> {
    await this.runMiddleware({ event }, () => this.notifications.dispatch(event));
  }

  async dispatchFleetStarted(issueCount: number, maxParallel: number): Promise<void> {
    await this.dispatchEvent({
      type: 'fleet-started',
      issueCount,
      maxParallel,
    });
  }

  async dispatchFleetCompleted(
    success: boolean,
    prsCreated: number,
    failedIssues: number,
    totalDuration: number,
    totalTokens: number,
  ): Promise<void> {
    await this.dispatchEvent({
      type: 'fleet-completed',
      success,
      prsCreated,
      failedIssues,
      totalDuration,
      totalTokens,
    });
  }

  async dispatchBudgetExceeded(currentUsage: number, budget: number): Promise<void> {
    await this.dispatchEvent({
      type: 'budget-exceeded',
      scope: 'fleet',
      currentUsage,
      budget,
    });
  }

  async dispatchBudgetWarning(currentUsage: number, budget: number, percentUsed: number): Promise<void> {
    await this.dispatchEvent({
      type: 'budget-warning',
      scope: 'fleet',
      currentUsage,
      budget,
      percentUsed,
    });
  }

  async appendFleetStarted(issueCount: number): Promise<void> {
    await this.fleetProgress.appendEvent(
      `Fleet started: ${issueCount} issues`,
    );
  }

  async appendFleetCompleted(prsCreated: number, failedIssues: number): Promise<void> {
    await this.fleetProgress.appendEvent(
      `Fleet completed: ${prsCreated} PRs, ${failedIssues} failures`,
    );
  }
}
