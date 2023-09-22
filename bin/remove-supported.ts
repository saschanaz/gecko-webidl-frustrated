import * as webidl from "npm:gecko-webidl@1.0.1"
import bcdApi from "npm:bcd-idl-mapper@2.2.2"
import bcd from "npm:@mdn/browser-compat-data@5.3.17" with { type: "json" }
import { supportedByGeckoEverywhere } from "../lib/support.ts";

const exceptions: Record<string, string[]> = {
  Window: [
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1231131
    // https://github.com/mdn/browser-compat-data/issues/20784
    "CanvasCaptureMediaStreamTrack",
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1854624
    // https://github.com/mdn/browser-compat-data/issues/20785
    "DeviceMotionEventAcceleration",
    "DeviceMotionEventRotationRate",
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1520406
    "External",
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1213422
    // https://github.com/mdn/browser-compat-data/issues/20786
    "InputDeviceInfo",
    // We don't expose touch interfaces on devices without touch
    "Touch",
    "TouchEvent",
    "TouchList",
  ]
};

// Iterate the webidl directory
const base = new URL("../../gecko-dev/dom/webidl/", import.meta.url);
for await (const file of Deno.readDir(base)) {
  if (!file.name.endsWith(".webidl")) {
    continue;
  }

  // Parse each IDL file
  const fileUrl = new URL(file.name, base);
  const idl = await Deno.readTextFile(fileUrl)
  let ast;
  try {
    ast = webidl.parse(idl);
  } catch (cause) {
    console.warn(`Skipping ${fileUrl.toString()}:`, cause.message);
    continue;
  }

  // Pick interfaces and trim [InstrumentedProps] based on BCD support data
  let trimmed = false;
  for (const i of ast.filter(i => i.type === "interface" && !i.partial)) {
    trimmed ||= trimInstrumentedProps(i);
  }

  // Rewrite IDL if the trim happened
  if (trimmed) {
    await Deno.writeTextFile(fileUrl, webidl.write(ast));
  }
}

function getInstrumentedPropsExtendedAttr(i) {
  return i.extAttrs
    .find(e => e.name === "InstrumentedProps")?.rhs.value;
}

function trimInstrumentedProps(i) {
  // Get the list from [InstrumentedProps=?]
  const instrumentedProps = getInstrumentedPropsExtendedAttr(i);
  if (!instrumentedProps) {
    return false;
  }

  const redundant: string[] = [];

  // Map each interface to BCD item
  const dataTarget = [bcdApi[i.name]];
  if (i.name === "Window") {
    dataTarget.push(bcdApi, bcd.javascript.builtins);
  } else if (i.name === "HTMLDocument") {
    dataTarget.length = 0;
    dataTarget.push(bcdApi.Document);
  }

  // Iterate the instrumented props list and pick the ones now supported by Gecko
  for (const prop of instrumentedProps.map(t => t.value)) {
    if (exceptions[i.name]?.includes(prop)) {
      continue;
    }
    const data = dataTarget.find(target => target[prop])?.[prop];
    if (!data) {
      continue;
    }
    if (supportedByGeckoEverywhere(data.__compat.support)) {
      redundant.push(prop);
    }
  }

  // And remove them from the list, directly in AST
  // XXX: This can cause invalid IDL syntax in some cases, e.g. trailing comma
  const trimmed = instrumentedProps.filter(p => !redundant.includes(p.value));
  instrumentedProps.length = 0;
  instrumentedProps.push(...trimmed);

  return !!redundant.length;
}
