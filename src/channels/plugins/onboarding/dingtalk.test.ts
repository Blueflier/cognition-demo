import { describe, expect, it } from "vitest";
import { dingtalkOnboardingAdapter } from "./dingtalk.js";

describe("dingtalkOnboardingAdapter", () => {
  it("reports unconfigured status when no credentials are set", async () => {
    const status = await dingtalkOnboardingAdapter.getStatus({
      cfg: {},
      accountOverrides: {},
    });
    expect(status.channel).toBe("dingtalk");
    expect(status.configured).toBe(false);
    expect(status.statusLines).toEqual(["DingTalk: needs app credentials"]);
  });

  it("reports configured status when appKey and appSecret are set", async () => {
    const status = await dingtalkOnboardingAdapter.getStatus({
      cfg: {
        channels: {
          dingtalk: {
            appKey: "test-app-key",
            appSecret: "test-app-secret",
          },
        },
      },
      accountOverrides: {},
    });
    expect(status.channel).toBe("dingtalk");
    expect(status.configured).toBe(true);
    expect(status.statusLines).toEqual(["DingTalk: configured"]);
  });

  it("disables the channel", () => {
    const cfg = {
      channels: {
        dingtalk: { enabled: true, appKey: "key" },
      },
    };
    const result = dingtalkOnboardingAdapter.disable!(cfg);
    expect(result.channels?.dingtalk).toMatchObject({ enabled: false, appKey: "key" });
  });

  it("exposes dmPolicy with correct keys", () => {
    expect(dingtalkOnboardingAdapter.dmPolicy).toBeDefined();
    expect(dingtalkOnboardingAdapter.dmPolicy!.channel).toBe("dingtalk");
    expect(dingtalkOnboardingAdapter.dmPolicy!.policyKey).toBe("channels.dingtalk.dmPolicy");
    expect(dingtalkOnboardingAdapter.dmPolicy!.allowFromKey).toBe("channels.dingtalk.allowFrom");
  });

  it("dmPolicy getCurrent returns pairing by default", () => {
    expect(dingtalkOnboardingAdapter.dmPolicy!.getCurrent({})).toBe("pairing");
    expect(
      dingtalkOnboardingAdapter.dmPolicy!.getCurrent({
        channels: { dingtalk: { dmPolicy: "allowlist" } },
      }),
    ).toBe("allowlist");
  });
});
