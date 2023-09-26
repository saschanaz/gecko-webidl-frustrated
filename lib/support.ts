import { SimpleSupportStatement, SupportBlock } from "npm:@mdn/browser-compat-data/types";

function hasStableImpl(
  browser: SimpleSupportStatement | SimpleSupportStatement[] | undefined
): boolean {
  if (!browser) {
    return false;
  }
  const latest = !Array.isArray(browser)
    ? browser
    : browser.find((i) => !i.prefix); // first one without prefix
  if (!latest) {
    return false;
  }
  // Added in a stable release, not removed, not behind pref, under standard name
  return (
    !!latest.version_added &&
    latest.version_added !== "preview" &&
    !latest.version_removed &&
    !latest.flags &&
    !latest.prefix &&
    !latest.alternative_name
  );
}

export function supportedByGeckoEverywhere(support: SupportBlock) {
  return hasStableImpl(support.firefox) && hasStableImpl(support.firefox_android);
}

export function lacksOnlyGeckoSupport(support: SupportBlock) {
  const geckoAll = supportedByGeckoEverywhere(support);
  const blinkAny = hasStableImpl(support.chrome) || hasStableImpl(support.chrome_android);
  const webkitAny = hasStableImpl(support.safari) || hasStableImpl(support.safari_ios);
  return !geckoAll && blinkAny && webkitAny;
}

export function lacksOthersSupport(support: SupportBlock) {
  const blinkAny = hasStableImpl(support.chrome) || hasStableImpl(support.chrome_android);
  const webkitAny = hasStableImpl(support.safari) || hasStableImpl(support.safari_ios);
  return !blinkAny && !webkitAny;
}
