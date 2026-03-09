import type { OpenClawConfig } from "../../../config/config.js";
import { hasConfiguredSecretInput } from "../../../config/types.secrets.js";
import { DEFAULT_ACCOUNT_ID } from "../../../routing/session-key.js";
import { formatDocsLink } from "../../../terminal/links.js";
import type { WizardPrompter } from "../../../wizard/prompts.js";
import type { ChannelOnboardingAdapter, ChannelOnboardingDmPolicy } from "../onboarding-types.js";
import {
  addWildcardAllowFrom,
  promptSingleChannelSecretInput,
  splitOnboardingEntries,
} from "./helpers.js";

const channel = "dingtalk" as const;

type DingTalkChannelConfig = {
  enabled?: boolean;
  appKey?: unknown;
  appSecret?: unknown;
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: Array<string | number>;
  robotCode?: string;
  webhookPath?: string;
};

function getDingTalkConfig(cfg: OpenClawConfig): DingTalkChannelConfig | undefined {
  return cfg.channels?.dingtalk as DingTalkChannelConfig | undefined;
}

function setDingTalkDmPolicy(
  cfg: OpenClawConfig,
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled",
): OpenClawConfig {
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(getDingTalkConfig(cfg)?.allowFrom)?.map((entry) => String(entry))
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: {
        ...cfg.channels?.dingtalk,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setDingTalkAllowFrom(cfg: OpenClawConfig, allowFrom: string[]): OpenClawConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: {
        ...cfg.channels?.dingtalk,
        allowFrom,
      },
    },
  };
}

function parseAllowFromInput(raw: string): string[] {
  return splitOnboardingEntries(raw);
}

async function noteDingTalkCredentialHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Go to DingTalk Open Platform (open.dingtalk.com)",
      "2) Create an enterprise internal application or robot",
      "3) Get App Key (Client ID) and App Secret (Client Secret) from the Credentials page",
      "4) Enable the robot capability and configure message callback URL or Stream mode",
      "5) Publish the app or deploy to your organization",
      "Tip: you can also set DINGTALK_APP_KEY / DINGTALK_APP_SECRET env vars.",
      `Docs: ${formatDocsLink("/channels/dingtalk", "dingtalk")}`,
    ].join("\n"),
    "DingTalk credentials",
  );
}

async function promptDingTalkAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
}): Promise<OpenClawConfig> {
  const existing = getDingTalkConfig(params.cfg)?.allowFrom ?? [];
  await params.prompter.note(
    [
      "Allowlist DingTalk DMs by staffId or unionId.",
      "You can find user ids in the DingTalk admin console or via API.",
      "Examples:",
      "- staffId:0001",
      "- unionId:xxxxxxxxxxxxxxxx",
      "Multiple entries: comma-separated.",
      `Docs: ${formatDocsLink("/channels/dingtalk", "dingtalk")}`,
    ].join("\n"),
    "DingTalk allowlist",
  );

  while (true) {
    const entry = await params.prompter.text({
      message: "DingTalk allowFrom (staff ids or union ids)",
      placeholder: "staffId:0001, unionId:xxxxx",
      initialValue: existing[0] ? String(existing[0]) : undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    });
    const parts = parseAllowFromInput(String(entry));
    if (parts.length === 0) {
      await params.prompter.note("Enter at least one user.", "DingTalk allowlist");
      continue;
    }

    const unique = [
      ...new Set([
        ...existing.map((v: string | number) => String(v).trim()).filter(Boolean),
        ...parts,
      ]),
    ];
    return setDingTalkAllowFrom(params.cfg, unique);
  }
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "DingTalk",
  channel,
  policyKey: "channels.dingtalk.dmPolicy",
  allowFromKey: "channels.dingtalk.allowFrom",
  getCurrent: (cfg) => getDingTalkConfig(cfg)?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setDingTalkDmPolicy(cfg, policy),
  promptAllowFrom: promptDingTalkAllowFrom,
};

export const dingtalkOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const dingtalkCfg = getDingTalkConfig(cfg);
    const configured = Boolean(
      typeof dingtalkCfg?.appKey === "string" &&
      dingtalkCfg.appKey.trim() &&
      hasConfiguredSecretInput(dingtalkCfg?.appSecret),
    );
    const envConfigured = Boolean(
      process.env.DINGTALK_APP_KEY?.trim() && process.env.DINGTALK_APP_SECRET?.trim(),
    );
    return {
      channel,
      configured: configured || envConfigured,
      statusLines: [
        `DingTalk: ${configured || envConfigured ? "configured" : "needs app credentials"}`,
      ],
      selectionHint: configured || envConfigured ? "configured" : "needs app creds",
      quickstartScore: configured || envConfigured ? 2 : 0,
    };
  },

  configure: async ({ cfg, prompter, options }) => {
    const dingtalkCfg = getDingTalkConfig(cfg);
    const hasConfigSecret = hasConfiguredSecretInput(dingtalkCfg?.appSecret);
    const hasConfigCreds = Boolean(
      typeof dingtalkCfg?.appKey === "string" && dingtalkCfg.appKey.trim() && hasConfigSecret,
    );
    const canUseEnv = Boolean(
      !hasConfigCreds &&
      process.env.DINGTALK_APP_KEY?.trim() &&
      process.env.DINGTALK_APP_SECRET?.trim(),
    );

    let next = cfg;

    if (!hasConfigCreds && !canUseEnv) {
      await noteDingTalkCredentialHelp(prompter);
    }

    const appSecretResult = await promptSingleChannelSecretInput({
      cfg: next,
      prompter,
      providerHint: "dingtalk",
      credentialLabel: "DingTalk App Secret",
      secretInputMode: options?.secretInputMode,
      accountConfigured: hasConfigCreds,
      canUseEnv,
      hasConfigToken: hasConfigSecret,
      envPrompt: "DINGTALK_APP_KEY + DINGTALK_APP_SECRET detected. Use env vars?",
      keepPrompt: "DingTalk App Secret already configured. Keep it?",
      inputPrompt: "Enter DingTalk App Secret (Client Secret)",
      preferredEnvVar: "DINGTALK_APP_SECRET",
    });

    if (appSecretResult.action === "use-env") {
      next = {
        ...next,
        channels: {
          ...next.channels,
          dingtalk: { ...next.channels?.dingtalk, enabled: true },
        },
      };
    } else if (appSecretResult.action === "set") {
      const appKey = String(
        await prompter.text({
          message: "Enter DingTalk App Key (Client ID)",
          initialValue:
            (typeof dingtalkCfg?.appKey === "string" ? dingtalkCfg.appKey.trim() : undefined) ??
            process.env.DINGTALK_APP_KEY?.trim(),
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();

      next = {
        ...next,
        channels: {
          ...next.channels,
          dingtalk: {
            ...next.channels?.dingtalk,
            enabled: true,
            appKey,
            appSecret: appSecretResult.value,
          },
        },
      };
    }

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },

  dmPolicy,

  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: { ...cfg.channels?.dingtalk, enabled: false },
    },
  }),
};
