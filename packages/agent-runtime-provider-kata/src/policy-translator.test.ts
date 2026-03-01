import { describe, it, expect } from "vitest";
import { translatePolicy } from "./policy-translator.js";
import { CapabilityMismatchError } from "./types.js";

describe("translatePolicy", () => {
  it("maps a full policy to KataSessionConfig", () => {
    const config = translatePolicy({
      memory: 512 * 1024 * 1024,
      cpu: 2,
      networkIsolation: true,
      readOnlyRootfs: true,
    });

    expect(config.runtime).toBe("io.containerd.kata.v2");
    expect(config.memoryLimitBytes).toBe(512 * 1024 * 1024);
    expect(config.cpuQuota).toBe(2);
    expect(config.networkIsolation).toBe(true);
    expect(config.readOnlyRootfs).toBe(true);
  });

  it("maps a partial policy with defaults for unset booleans", () => {
    const config = translatePolicy({ memory: 256 });

    expect(config.memoryLimitBytes).toBe(256);
    expect(config.cpuQuota).toBeUndefined();
    expect(config.networkIsolation).toBe(false);
    expect(config.readOnlyRootfs).toBe(false);
  });

  it("returns defaults for an empty policy", () => {
    const config = translatePolicy({});

    expect(config.runtime).toBe("io.containerd.kata.v2");
    expect(config.memoryLimitBytes).toBeUndefined();
    expect(config.cpuQuota).toBeUndefined();
    expect(config.networkIsolation).toBe(false);
    expect(config.readOnlyRootfs).toBe(false);
  });

  it("throws CapabilityMismatchError for unsupported policy fields", () => {
    expect(() =>
      translatePolicy({ memory: 128, unknownField: "value" } as any)
    ).toThrow(CapabilityMismatchError);

    try {
      translatePolicy({ memory: 128, unknownField: "value", anotherBad: 1 } as any);
    } catch (err) {
      expect(err).toBeInstanceOf(CapabilityMismatchError);
      const e = err as CapabilityMismatchError;
      expect(e.unsupportedPolicies).toContain("unknownField");
      expect(e.unsupportedPolicies).toContain("anotherBad");
    }
  });
});
