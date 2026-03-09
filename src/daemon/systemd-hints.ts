import { formatCliCommand } from "../cli/command-format.js";

export function isSystemdUnavailableDetail(detail?: string): boolean {
  if (!detail) {
    return false;
  }
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("systemctl --user unavailable") ||
    normalized.includes("systemctl not available") ||
    normalized.includes("not been booted with systemd") ||
    normalized.includes("failed to connect to bus") ||
    normalized.includes("systemd user services are required")
  );
}

/** Detect a D-Bus / XDG_RUNTIME_DIR–specific failure (headless servers, SSH sessions). */
export function isHeadlessDbusError(detail?: string): boolean {
  if (!detail) {
    return false;
  }
  const normalized = detail.toLowerCase();
  return (
    (normalized.includes("failed to connect to bus") ||
      normalized.includes("no medium found") ||
      normalized.includes("dbus_session_bus_address") ||
      normalized.includes("xdg_runtime_dir")) &&
    !normalized.includes("not been booted with systemd")
  );
}

export function renderSystemdUnavailableHints(
  options: {
    wsl?: boolean;
    headless?: boolean;
  } = {},
): string[] {
  if (options.wsl) {
    return [
      "WSL2 needs systemd enabled: edit /etc/wsl.conf with [boot]\\nsystemd=true",
      "Then run: wsl --shutdown (from PowerShell) and reopen your distro.",
      "Verify: systemctl --user status",
    ];
  }
  if (options.headless) {
    return [
      "systemctl --user unavailable: D-Bus session bus not found.",
      "",
      "On headless servers (EC2, GCP, Azure VMs, etc.), run:",
      "  sudo loginctl enable-linger $(whoami)",
      "  export XDG_RUNTIME_DIR=/run/user/$(id -u)",
      "",
      "Add the export to ~/.bashrc (or equivalent) to persist across sessions.",
      `Then retry: ${formatCliCommand("openclaw gateway install")}`,
    ];
  }
  return [
    "systemd user services are unavailable; install/enable systemd or run the gateway under your supervisor.",
    `If you're in a container, run the gateway in the foreground instead of \`${formatCliCommand("openclaw gateway")}\`.`,
  ];
}
