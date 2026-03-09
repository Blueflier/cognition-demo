import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { splitArgsPreservingQuotes } from "./arg-split.js";
import {
  isHeadlessDbusError,
  isSystemdUnavailableDetail,
  renderSystemdUnavailableHints,
} from "./systemd-hints.js";
import { parseSystemdExecStart } from "./systemd-unit.js";
import {
  isSystemdUserServiceAvailable,
  parseSystemdShow,
  restartSystemdService,
  resolveSystemdUserUnitPath,
  stopSystemdService,
} from "./systemd.js";

describe("systemd availability", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("returns true when systemctl --user succeeds", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, "", "");
    });
    await expect(isSystemdUserServiceAvailable()).resolves.toBe(true);
  });

  it("returns false when systemd user bus is unavailable", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error("Failed to connect to bus") as Error & {
        stderr?: string;
        code?: number;
      };
      err.stderr = "Failed to connect to bus";
      err.code = 1;
      cb(err, "", "");
    });
    await expect(isSystemdUserServiceAvailable()).resolves.toBe(false);
  });

  it("falls back to machine user scope when --user bus is unavailable", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "status"]);
        const err = new Error(
          "Failed to connect to user scope bus via local transport",
        ) as Error & {
          stderr?: string;
          code?: number;
        };
        err.stderr =
          "Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined";
        err.code = 1;
        cb(err, "", "");
      })
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--machine", "debian@", "--user", "status"]);
        cb(null, "", "");
      });

    await expect(isSystemdUserServiceAvailable({ USER: "debian" })).resolves.toBe(true);
  });
});

describe("isSystemdServiceEnabled", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("returns false when systemctl is not present", async () => {
    const { isSystemdServiceEnabled } = await import("./systemd.js");
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error("spawn systemctl EACCES") as Error & { code?: string };
      err.code = "EACCES";
      cb(err, "", "");
    });
    const result = await isSystemdServiceEnabled({ env: {} });
    expect(result).toBe(false);
  });

  it("calls systemctl is-enabled when systemctl is present", async () => {
    const { isSystemdServiceEnabled } = await import("./systemd.js");
    execFileMock.mockImplementationOnce((_cmd, args, _opts, cb) => {
      expect(args).toEqual(["--user", "is-enabled", "openclaw-gateway.service"]);
      cb(null, "enabled", "");
    });
    const result = await isSystemdServiceEnabled({ env: {} });
    expect(result).toBe(true);
  });

  it("returns false when systemctl reports disabled", async () => {
    const { isSystemdServiceEnabled } = await import("./systemd.js");
    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      const err = new Error("disabled") as Error & { code?: number };
      err.code = 1;
      cb(err, "disabled", "");
    });
    const result = await isSystemdServiceEnabled({ env: {} });
    expect(result).toBe(false);
  });

  it("throws when systemctl is-enabled fails for non-state errors", async () => {
    const { isSystemdServiceEnabled } = await import("./systemd.js");
    execFileMock
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "is-enabled", "openclaw-gateway.service"]);
        const err = new Error("Failed to connect to bus") as Error & { code?: number };
        err.code = 1;
        cb(err, "", "Failed to connect to bus");
      })
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args[0]).toBe("--machine");
        expect(String(args[1])).toMatch(/^[^@]+@$/);
        expect(args.slice(2)).toEqual(["--user", "is-enabled", "openclaw-gateway.service"]);
        const err = new Error("permission denied") as Error & { code?: number };
        err.code = 1;
        cb(err, "", "permission denied");
      });
    await expect(isSystemdServiceEnabled({ env: {} })).rejects.toThrow(
      "systemctl is-enabled unavailable: permission denied",
    );
  });

  it("returns false when systemctl is-enabled exits with code 4 (not-found)", async () => {
    const { isSystemdServiceEnabled } = await import("./systemd.js");
    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      // On Ubuntu 24.04, `systemctl --user is-enabled <unit>` exits with
      // code 4 and prints "not-found" to stdout when the unit doesn't exist.
      const err = new Error(
        "Command failed: systemctl --user is-enabled openclaw-gateway.service",
      ) as Error & { code?: number };
      err.code = 4;
      cb(err, "not-found\n", "");
    });
    const result = await isSystemdServiceEnabled({ env: {} });
    expect(result).toBe(false);
  });
});

describe("headless D-Bus detection (systemd-hints)", () => {
  it("detects 'No medium found' as a headless D-Bus error", () => {
    expect(
      isHeadlessDbusError(
        "systemctl --user unavailable: Failed to connect to bus: No medium found",
      ),
    ).toBe(true);
  });

  it("detects 'Failed to connect to bus' as a headless D-Bus error", () => {
    expect(isHeadlessDbusError("Failed to connect to bus")).toBe(true);
  });

  it("detects XDG_RUNTIME_DIR mention as a headless D-Bus error", () => {
    expect(
      isHeadlessDbusError(
        "Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined",
      ),
    ).toBe(true);
  });

  it("returns false for 'not been booted with systemd'", () => {
    expect(isHeadlessDbusError("System has not been booted with systemd")).toBe(false);
  });

  it("returns false for undefined/empty detail", () => {
    expect(isHeadlessDbusError(undefined)).toBe(false);
    expect(isHeadlessDbusError("")).toBe(false);
  });

  it("isSystemdUnavailableDetail detects all known error patterns", () => {
    expect(
      isSystemdUnavailableDetail(
        "systemctl --user unavailable: Failed to connect to bus: No medium found",
      ),
    ).toBe(true);
    expect(isSystemdUnavailableDetail("systemctl not available")).toBe(true);
    expect(isSystemdUnavailableDetail("System has not been booted with systemd")).toBe(true);
  });
});

describe("renderSystemdUnavailableHints", () => {
  it("renders headless-specific hints when headless=true", () => {
    const hints = renderSystemdUnavailableHints({ headless: true });
    const joined = hints.join("\n");
    expect(joined).toContain("D-Bus session bus not found");
    expect(joined).toContain("sudo loginctl enable-linger");
    expect(joined).toContain("export XDG_RUNTIME_DIR");
    expect(joined).toContain("EC2");
  });

  it("renders generic hints when headless=false", () => {
    const hints = renderSystemdUnavailableHints({ headless: false });
    const joined = hints.join("\n");
    expect(joined).toContain("install/enable systemd");
    expect(joined).not.toContain("D-Bus session bus not found");
  });

  it("renders WSL hints when wsl=true (takes priority over headless)", () => {
    const hints = renderSystemdUnavailableHints({ wsl: true, headless: true });
    const joined = hints.join("\n");
    expect(joined).toContain("WSL2");
    expect(joined).not.toContain("D-Bus session bus not found");
  });
});

describe("assertSystemdAvailable headless error", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("throws actionable D-Bus error when 'No medium found' is returned", async () => {
    const { installSystemdService } = await import("./systemd.js");
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        const err = new Error("Failed to connect to bus: No medium found") as Error & {
          stderr?: string;
          code?: number;
        };
        err.stderr = "Failed to connect to bus: No medium found";
        err.code = 1;
        cb(err, "", "");
      },
    );
    await expect(
      installSystemdService({
        env: {},
        stdout: { write: vi.fn() } as unknown as NodeJS.WritableStream,
        programArguments: ["openclaw", "gateway", "start"],
      }),
    ).rejects.toThrow(/D-Bus session bus/);
  });

  it("includes fix instructions in the headless D-Bus error", async () => {
    const { installSystemdService } = await import("./systemd.js");
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        const err = new Error("Failed to connect to bus: No medium found") as Error & {
          stderr?: string;
          code?: number;
        };
        err.stderr = "Failed to connect to bus: No medium found";
        err.code = 1;
        cb(err, "", "");
      },
    );
    await expect(
      installSystemdService({
        env: {},
        stdout: { write: vi.fn() } as unknown as NodeJS.WritableStream,
        programArguments: ["openclaw", "gateway", "start"],
      }),
    ).rejects.toThrow(/sudo loginctl enable-linger/);
  });
});

describe("systemd runtime parsing", () => {
  it("parses active state details", () => {
    const output = [
      "ActiveState=inactive",
      "SubState=dead",
      "MainPID=0",
      "ExecMainStatus=2",
      "ExecMainCode=exited",
    ].join("\n");
    expect(parseSystemdShow(output)).toEqual({
      activeState: "inactive",
      subState: "dead",
      execMainStatus: 2,
      execMainCode: "exited",
    });
  });
});

describe("resolveSystemdUserUnitPath", () => {
  it.each([
    {
      name: "uses default service name when OPENCLAW_PROFILE is unset",
      env: { HOME: "/home/test" },
      expected: "/home/test/.config/systemd/user/openclaw-gateway.service",
    },
    {
      name: "uses profile-specific service name when OPENCLAW_PROFILE is set to a custom value",
      env: { HOME: "/home/test", OPENCLAW_PROFILE: "jbphoenix" },
      expected: "/home/test/.config/systemd/user/openclaw-gateway-jbphoenix.service",
    },
    {
      name: "prefers OPENCLAW_SYSTEMD_UNIT over OPENCLAW_PROFILE",
      env: {
        HOME: "/home/test",
        OPENCLAW_PROFILE: "jbphoenix",
        OPENCLAW_SYSTEMD_UNIT: "custom-unit",
      },
      expected: "/home/test/.config/systemd/user/custom-unit.service",
    },
    {
      name: "handles OPENCLAW_SYSTEMD_UNIT with .service suffix",
      env: {
        HOME: "/home/test",
        OPENCLAW_SYSTEMD_UNIT: "custom-unit.service",
      },
      expected: "/home/test/.config/systemd/user/custom-unit.service",
    },
    {
      name: "trims whitespace from OPENCLAW_SYSTEMD_UNIT",
      env: {
        HOME: "/home/test",
        OPENCLAW_SYSTEMD_UNIT: "  custom-unit  ",
      },
      expected: "/home/test/.config/systemd/user/custom-unit.service",
    },
  ])("$name", ({ env, expected }) => {
    expect(resolveSystemdUserUnitPath(env)).toBe(expected);
  });
});

describe("splitArgsPreservingQuotes", () => {
  it("splits on whitespace outside quotes", () => {
    expect(splitArgsPreservingQuotes('/usr/bin/openclaw gateway start --name "My Bot"')).toEqual([
      "/usr/bin/openclaw",
      "gateway",
      "start",
      "--name",
      "My Bot",
    ]);
  });

  it("supports systemd-style backslash escaping", () => {
    expect(
      splitArgsPreservingQuotes('openclaw --name "My \\"Bot\\"" --foo bar', {
        escapeMode: "backslash",
      }),
    ).toEqual(["openclaw", "--name", 'My "Bot"', "--foo", "bar"]);
  });

  it("supports schtasks-style escaped quotes while preserving other backslashes", () => {
    expect(
      splitArgsPreservingQuotes('openclaw --path "C:\\\\Program Files\\\\OpenClaw"', {
        escapeMode: "backslash-quote-only",
      }),
    ).toEqual(["openclaw", "--path", "C:\\\\Program Files\\\\OpenClaw"]);

    expect(
      splitArgsPreservingQuotes('openclaw --label "My \\"Quoted\\" Name"', {
        escapeMode: "backslash-quote-only",
      }),
    ).toEqual(["openclaw", "--label", 'My "Quoted" Name']);
  });
});

describe("parseSystemdExecStart", () => {
  it("preserves quoted arguments", () => {
    const execStart = '/usr/bin/openclaw gateway start --name "My Bot"';
    expect(parseSystemdExecStart(execStart)).toEqual([
      "/usr/bin/openclaw",
      "gateway",
      "start",
      "--name",
      "My Bot",
    ]);
  });
});

describe("systemd service control", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("stops the resolved user unit", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, "", ""))
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "stop", "openclaw-gateway.service"]);
        cb(null, "", "");
      });
    const write = vi.fn();
    const stdout = { write } as unknown as NodeJS.WritableStream;

    await stopSystemdService({ stdout, env: {} });

    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain("Stopped systemd service");
  });

  it("restarts a profile-specific user unit", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, "", ""))
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "restart", "openclaw-gateway-work.service"]);
        cb(null, "", "");
      });
    const write = vi.fn();
    const stdout = { write } as unknown as NodeJS.WritableStream;

    await restartSystemdService({ stdout, env: { OPENCLAW_PROFILE: "work" } });

    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain("Restarted systemd service");
  });

  it("surfaces stop failures with systemctl detail", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, "", ""))
      .mockImplementationOnce((_cmd, _args, _opts, cb) => {
        const err = new Error("stop failed") as Error & { code?: number };
        err.code = 1;
        cb(err, "", "permission denied");
      });

    await expect(
      stopSystemdService({
        stdout: { write: vi.fn() } as unknown as NodeJS.WritableStream,
        env: {},
      }),
    ).rejects.toThrow("systemctl stop failed: permission denied");
  });

  it("targets the sudo caller's user scope when SUDO_USER is set", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--machine", "debian@", "--user", "status"]);
        cb(null, "", "");
      })
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual([
          "--machine",
          "debian@",
          "--user",
          "restart",
          "openclaw-gateway.service",
        ]);
        cb(null, "", "");
      });
    const write = vi.fn();
    const stdout = { write } as unknown as NodeJS.WritableStream;

    await restartSystemdService({ stdout, env: { SUDO_USER: "debian" } });

    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain("Restarted systemd service");
  });

  it("keeps direct --user scope when SUDO_USER is root", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "status"]);
        cb(null, "", "");
      })
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "restart", "openclaw-gateway.service"]);
        cb(null, "", "");
      });
    const write = vi.fn();
    const stdout = { write } as unknown as NodeJS.WritableStream;

    await restartSystemdService({ stdout, env: { SUDO_USER: "root", USER: "root" } });

    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain("Restarted systemd service");
  });

  it("falls back to machine user scope for restart when user bus env is missing", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "status"]);
        const err = new Error("Failed to connect to user scope bus") as Error & {
          stderr?: string;
          code?: number;
        };
        err.stderr =
          "Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined";
        err.code = 1;
        cb(err, "", "");
      })
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--machine", "debian@", "--user", "status"]);
        cb(null, "", "");
      })
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual(["--user", "restart", "openclaw-gateway.service"]);
        const err = new Error("Failed to connect to user scope bus") as Error & {
          stderr?: string;
          code?: number;
        };
        err.stderr = "Failed to connect to user scope bus";
        err.code = 1;
        cb(err, "", "");
      })
      .mockImplementationOnce((_cmd, args, _opts, cb) => {
        expect(args).toEqual([
          "--machine",
          "debian@",
          "--user",
          "restart",
          "openclaw-gateway.service",
        ]);
        cb(null, "", "");
      });
    const write = vi.fn();
    const stdout = { write } as unknown as NodeJS.WritableStream;

    await restartSystemdService({ stdout, env: { USER: "debian" } });

    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain("Restarted systemd service");
  });
});
