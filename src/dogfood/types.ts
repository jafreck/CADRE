/**
 * Type definitions for the dogfood pipeline.
 */

export type SeverityLevel = 'critical' | 'severe' | 'high' | 'medium' | 'low';

export interface DogfoodSignal {
  subsystem: string;
  failureMode: string;
  message: string;
  issueNumber?: number;
  severity?: SeverityLevel;
  timestamp: string;
  impactScope?: string;
}

export interface TopicKey {
  subsystem: string;
  failureMode: string;
  impactScope: string;
}

export interface DogfoodTopic {
  key: TopicKey;
  signals: DogfoodSignal[];
  severity: SeverityLevel;
  mergedCount: number;
  affectedIssues: number[];
  firstSeen: string;
  lastSeen: string;
}

export interface TriageResult {
  topics: DogfoodTopic[];
  filed: DogfoodIssueContent[];
  skippedBelowThreshold: DogfoodTopic[];
  skippedOverCap: DogfoodTopic[];
}

export interface DogfoodIssueContent {
  topicKey: TopicKey;
  title: string;
  body: string;
  labels: string[];
  severity: SeverityLevel;
  priority: number;
}
