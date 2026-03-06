import { describe, expect, it, vi } from "vitest";
import {
  applyConfigSnapshot,
  applyConfig,
  loadConfig,
  loadConfigSchema,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
  type ConfigState,
} from "./config.ts";

function createState(): ConfigState {
  return {
    applySessionKey: "main",
    client: null,
    configActiveSection: null,
    configActiveSubsection: null,
    configApplying: false,
    configForm: null,
    configFormDirty: false,
    configFormMode: "form",
    configFormOriginal: null,
    configIssues: [],
    configLoading: false,
    configRaw: "",
    configRawOriginal: "",
    configSaving: false,
    configSchema: null,
    configSchemaLoading: false,
    configSchemaVersion: null,
    configSearchQuery: "",
    configSnapshot: null,
    configUiHints: {},
    configValid: null,
    connected: false,
    lastError: null,
    updateRunning: false,
  };
}

function createRequestWithConfigGet() {
  return vi.fn().mockImplementation(async (method: string) => {
    if (method === "config.get") {
      return { config: {}, valid: true, issues: [], raw: "{\n}\n" };
    }
    return {};
  });
}

describe("loadConfig", () => {
  it("schedules a retry when client exists but not connected", () => {
    vi.useFakeTimers();
    const request = vi.fn();
    const state = createState();
    state.client = { request } as unknown as ConfigState["client"];
    state.connected = false;

    void loadConfig(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.configForm).toBeNull();

    // Simulate connection becoming available before retry fires
    state.connected = true;
    request.mockResolvedValue({
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{}",
    });

    vi.advanceTimersByTime(1000);

    // The retry should have been scheduled and fired
    expect(request).toHaveBeenCalledWith("config.get", {});
    vi.useRealTimers();
  });

  it("does not retry when client is null", () => {
    vi.useFakeTimers();
    const state = createState();
    state.client = null;
    state.connected = false;

    void loadConfig(state);

    vi.advanceTimersByTime(6000);
    // Nothing should happen — no client means no retry
    expect(state.configForm).toBeNull();
    vi.useRealTimers();
  });

  it("stops retrying after max attempts", () => {
    vi.useFakeTimers();
    const request = vi.fn();
    const state = createState();
    state.client = { request } as unknown as ConfigState["client"];
    state.connected = false;

    void loadConfig(state);

    // Advance through 5 retries (max) — connection never established
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(1000);
    }

    // request should never have been called since connected stayed false
    expect(request).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("loads config immediately when already connected", async () => {
    const request = vi.fn().mockResolvedValue({
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{}",
    });
    const state = createState();
    state.client = { request } as unknown as ConfigState["client"];
    state.connected = true;

    await loadConfig(state);

    expect(request).toHaveBeenCalledWith("config.get", {});
    expect(state.configForm).toEqual({ gateway: { mode: "local" } });
  });
});

describe("loadConfigSchema", () => {
  it("schedules a retry when client exists but not connected", () => {
    vi.useFakeTimers();
    const request = vi.fn();
    const state = createState();
    state.client = { request } as unknown as ConfigState["client"];
    state.connected = false;

    void loadConfigSchema(state);

    expect(request).not.toHaveBeenCalled();

    // Simulate connection becoming available before retry fires
    state.connected = true;
    request.mockResolvedValue({
      schema: { type: "object" },
      uiHints: {},
      version: "1.0",
    });

    vi.advanceTimersByTime(1000);

    expect(request).toHaveBeenCalledWith("config.schema", {});
    vi.useRealTimers();
  });

  it("loads schema immediately when already connected", async () => {
    const request = vi.fn().mockResolvedValue({
      schema: { type: "object" },
      uiHints: { foo: "bar" },
      version: "2.0",
    });
    const state = createState();
    state.client = { request } as unknown as ConfigState["client"];
    state.connected = true;

    await loadConfigSchema(state);

    expect(request).toHaveBeenCalledWith("config.schema", {});
    expect(state.configSchema).toEqual({ type: "object" });
    expect(state.configSchemaVersion).toBe("2.0");
  });
});

describe("applyConfigSnapshot", () => {
  it("does not clobber form edits while dirty", () => {
    const state = createState();
    state.configFormMode = "form";
    state.configFormDirty = true;
    state.configForm = { gateway: { mode: "local", port: 18789 } };
    state.configRaw = "{\n}\n";

    applyConfigSnapshot(state, {
      config: { gateway: { mode: "remote", port: 9999 } },
      valid: true,
      issues: [],
      raw: '{\n  "gateway": { "mode": "remote", "port": 9999 }\n}\n',
    });

    expect(state.configRaw).toBe(
      '{\n  "gateway": {\n    "mode": "local",\n    "port": 18789\n  }\n}\n',
    );
  });

  it("updates config form when clean", () => {
    const state = createState();
    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{}",
    });

    expect(state.configForm).toEqual({ gateway: { mode: "local" } });
  });

  it("sets configRawOriginal when clean for change detection", () => {
    const state = createState();
    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: '{ "gateway": { "mode": "local" } }',
    });

    expect(state.configRawOriginal).toBe('{ "gateway": { "mode": "local" } }');
    expect(state.configFormOriginal).toEqual({ gateway: { mode: "local" } });
  });

  it("preserves configRawOriginal when dirty", () => {
    const state = createState();
    state.configFormDirty = true;
    state.configRawOriginal = '{ "original": true }';
    state.configFormOriginal = { original: true };

    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: '{ "gateway": { "mode": "local" } }',
    });

    // Original values should be preserved when dirty
    expect(state.configRawOriginal).toBe('{ "original": true }');
    expect(state.configFormOriginal).toEqual({ original: true });
  });
});

describe("updateConfigFormValue", () => {
  it("seeds from snapshot when form is null", () => {
    const state = createState();
    state.configSnapshot = {
      config: { channels: { telegram: { botToken: "t" } }, gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{}",
    };

    updateConfigFormValue(state, ["gateway", "port"], 18789);

    expect(state.configFormDirty).toBe(true);
    expect(state.configForm).toEqual({
      channels: { telegram: { botToken: "t" } },
      gateway: { mode: "local", port: 18789 },
    });
  });

  it("keeps raw in sync while editing the form", () => {
    const state = createState();
    state.configSnapshot = {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{\n}\n",
    };

    updateConfigFormValue(state, ["gateway", "port"], 18789);

    expect(state.configRaw).toBe(
      '{\n  "gateway": {\n    "mode": "local",\n    "port": 18789\n  }\n}\n',
    );
  });
});

describe("applyConfig", () => {
  it("sends config.apply with raw and session key", async () => {
    const request = vi.fn().mockResolvedValue({});
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.applySessionKey = "agent:main:whatsapp:dm:+15555550123";
    state.configFormMode = "raw";
    state.configRaw = '{\n  agent: { workspace: "~/openclaw" }\n}\n';
    state.configSnapshot = {
      hash: "hash-123",
    };

    await applyConfig(state);

    expect(request).toHaveBeenCalledWith("config.apply", {
      raw: '{\n  agent: { workspace: "~/openclaw" }\n}\n',
      baseHash: "hash-123",
      sessionKey: "agent:main:whatsapp:dm:+15555550123",
    });
  });

  it("coerces schema-typed values before config.apply in form mode", async () => {
    const request = createRequestWithConfigGet();
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.applySessionKey = "agent:main:web:dm:test";
    state.configFormMode = "form";
    state.configForm = {
      gateway: { port: "18789", debug: "true" },
    };
    state.configSchema = {
      type: "object",
      properties: {
        gateway: {
          type: "object",
          properties: {
            port: { type: "number" },
            debug: { type: "boolean" },
          },
        },
      },
    };
    state.configSnapshot = { hash: "hash-apply-1" };

    await applyConfig(state);

    expect(request.mock.calls[0]?.[0]).toBe("config.apply");
    const params = request.mock.calls[0]?.[1] as {
      raw: string;
      baseHash: string;
      sessionKey: string;
    };
    const parsed = JSON.parse(params.raw) as {
      gateway: { port: unknown; debug: unknown };
    };
    expect(typeof parsed.gateway.port).toBe("number");
    expect(parsed.gateway.port).toBe(18789);
    expect(parsed.gateway.debug).toBe(true);
    expect(params.baseHash).toBe("hash-apply-1");
    expect(params.sessionKey).toBe("agent:main:web:dm:test");
  });
});

describe("saveConfig", () => {
  it("coerces schema-typed values before config.set in form mode", async () => {
    const request = createRequestWithConfigGet();
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormMode = "form";
    state.configForm = {
      gateway: { port: "18789", enabled: "false" },
    };
    state.configSchema = {
      type: "object",
      properties: {
        gateway: {
          type: "object",
          properties: {
            port: { type: "number" },
            enabled: { type: "boolean" },
          },
        },
      },
    };
    state.configSnapshot = { hash: "hash-save-1" };

    await saveConfig(state);

    expect(request.mock.calls[0]?.[0]).toBe("config.set");
    const params = request.mock.calls[0]?.[1] as { raw: string; baseHash: string };
    const parsed = JSON.parse(params.raw) as {
      gateway: { port: unknown; enabled: unknown };
    };
    expect(typeof parsed.gateway.port).toBe("number");
    expect(parsed.gateway.port).toBe(18789);
    expect(parsed.gateway.enabled).toBe(false);
    expect(params.baseHash).toBe("hash-save-1");
  });

  it("skips coercion when schema is not an object", async () => {
    const request = createRequestWithConfigGet();
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormMode = "form";
    state.configForm = {
      gateway: { port: "18789" },
    };
    state.configSchema = "invalid-schema";
    state.configSnapshot = { hash: "hash-save-2" };

    await saveConfig(state);

    expect(request.mock.calls[0]?.[0]).toBe("config.set");
    const params = request.mock.calls[0]?.[1] as { raw: string; baseHash: string };
    const parsed = JSON.parse(params.raw) as {
      gateway: { port: unknown };
    };
    expect(parsed.gateway.port).toBe("18789");
    expect(params.baseHash).toBe("hash-save-2");
  });
});

describe("runUpdate", () => {
  it("sends update.run with session key", async () => {
    const request = vi.fn().mockResolvedValue({});
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.applySessionKey = "agent:main:whatsapp:dm:+15555550123";

    await runUpdate(state);

    expect(request).toHaveBeenCalledWith("update.run", {
      sessionKey: "agent:main:whatsapp:dm:+15555550123",
    });
  });
});
