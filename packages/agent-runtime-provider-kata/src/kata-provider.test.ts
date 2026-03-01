import { describe, it, expect, vi, beforeEach } from "vitest";
import { KataProvider, type KataAdapter } from "./kata-provider.js";
import { CapabilityMismatchError, type KataSessionConfig } from "./types.js";

function makeMockAdapter(): KataAdapter {
  return {
    createSandbox: vi.fn().mockResolvedValue(undefined),
    execInSandbox: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "hello", stderr: "" }),
    stopSandbox: vi.fn().mockResolvedValue(undefined),
    destroySandbox: vi.fn().mockResolvedValue(undefined),
  };
}

describe("KataProvider", () => {
  let adapter: KataAdapter;
  let provider: KataProvider;

  beforeEach(() => {
    adapter = makeMockAdapter();
    provider = new KataProvider(adapter);
  });

  describe("startSession", () => {
    it("translates the policy and creates a sandbox, returning a session ID", async () => {
      const sessionId = await provider.startSession({ memory: 256, cpu: 1 });
      expect(typeof sessionId).toBe("string");
      expect(sessionId).toBeTruthy();
      expect(adapter.createSandbox).toHaveBeenCalledOnce();
      const [calledId, config] = (adapter.createSandbox as ReturnType<typeof vi.fn>).mock.calls[0] as [string, KataSessionConfig];
      expect(calledId).toBe(sessionId);
      expect(config.memoryLimitBytes).toBe(256);
      expect(config.cpuQuota).toBe(1);
    });

    it("throws CapabilityMismatchError for unsupported policy fields", async () => {
      await expect(
        provider.startSession({ memory: 128, unsupportedField: "bad" } as any)
      ).rejects.toBeInstanceOf(CapabilityMismatchError);
      expect(adapter.createSandbox).not.toHaveBeenCalled();
    });
  });

  describe("exec", () => {
    it("runs a command and returns stdout/stderr/exit code", async () => {
      const sessionId = await provider.startSession({});
      const result = await provider.exec(sessionId, ["echo", "hello"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello");
      expect(result.stderr).toBe("");
      expect(adapter.execInSandbox).toHaveBeenCalledWith(sessionId, ["echo", "hello"]);
    });

    it("throws when session ID is unknown", async () => {
      await expect(provider.exec("unknown-id", ["ls"])).rejects.toThrow("Session not found");
    });
  });

  describe("stopSession", () => {
    it("gracefully stops the session", async () => {
      const sessionId = await provider.startSession({});
      await provider.stopSession(sessionId);
      expect(adapter.stopSandbox).toHaveBeenCalledWith(sessionId);
    });

    it("throws when session ID is unknown", async () => {
      await expect(provider.stopSession("unknown-id")).rejects.toThrow("Session not found");
    });
  });

  describe("destroySession", () => {
    it("destroys the session and removes it from internal state", async () => {
      const sessionId = await provider.startSession({});
      await provider.destroySession(sessionId);
      expect(adapter.destroySandbox).toHaveBeenCalledWith(sessionId);
      // Subsequent operations on the destroyed session should throw
      await expect(provider.exec(sessionId, ["ls"])).rejects.toThrow("Session not found");
    });

    it("throws when session ID is unknown", async () => {
      await expect(provider.destroySession("unknown-id")).rejects.toThrow("Session not found");
    });
  });

  describe("full session lifecycle", () => {
    it("completes start -> exec -> stop -> destroy without errors", async () => {
      const sessionId = await provider.startSession({ networkIsolation: true, readOnlyRootfs: true });
      expect(sessionId).toBeTruthy();

      const result = await provider.exec(sessionId, ["whoami"]);
      expect(result.exitCode).toBe(0);

      await provider.stopSession(sessionId);
      await provider.destroySession(sessionId);

      expect(adapter.createSandbox).toHaveBeenCalledOnce();
      expect(adapter.execInSandbox).toHaveBeenCalledOnce();
      expect(adapter.stopSandbox).toHaveBeenCalledOnce();
      expect(adapter.destroySandbox).toHaveBeenCalledOnce();
    });
  });
});
