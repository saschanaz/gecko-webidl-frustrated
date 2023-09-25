import * as webidl from "npm:gecko-webidl@1.0.1"
import bcd from "npm:bcd-idl-mapper@2.2.2"
import { lacksOnlyGeckoSupport } from "../lib/support.ts";
import { getExposedGlobals, getInstrumentedPropsExtendedAttr, iterateIdls } from "../lib/idl.ts";

// Get missing entries
const missingEntries = [];

for (const [interfaceName, interfaceData] of Object.entries(bcd)) {
  // Global interfaces
  if (interfaceName.startsWith("_") ||
    // WebGL never exposes interfaces
    interfaceName.startsWith("EXT_") ||
    interfaceName.startsWith("KHR_") ||
    interfaceName.startsWith("OES_") ||
    interfaceName.startsWith("WEBGL_")) {
    continue;
  }
  if (lacksOnlyGeckoSupport(interfaceData.__compat.support)) {
    missingEntries.push(interfaceName);
  }
}

// Iterate the webidl directory
const base = new URL("../../gecko-dev/dom/webidl/", import.meta.url);
const astMap = new Map<string, any>();
const interfaceMap = new Map<string, any>();
for await (const { fileName, ast } of iterateIdls(base)) {
  // Collect interfaces and ASTs to rewrite later
  const interfaces = ast.filter(i => i.type === "interface" && !i.partial);
  for (const i of interfaces) {
    interfaceMap.set(i.name, i);
  }
  astMap.set(fileName, ast);
}

const window = interfaceMap.get("Window");
const instrumentedProps = getInstrumentedPropsExtendedAttr(window);

for (const entry of missingEntries) {
  // Skip already existing props
  if (instrumentedProps.find(p => p.value === entry)) {
    continue;
  }

  // Skip non-Window interfaces for now
  const idl = interfaceMap.get(entry);
  if (idl && !getExposedGlobals(idl).includes("Window")) {
    console.log("Skipping", entry, "as it's not exposed in Window")
    continue;
  }

  // Create new InstrumentedProps item
  const tokens = { ...instrumentedProps[1].tokens };
  tokens.value = { ...instrumentedProps[1].tokens.value, value: entry };
  const prop = new instrumentedProps[0].constructor({ tokens });
  instrumentedProps.push(prop);
}

// Sort props in alphabetical order
instrumentedProps.sort((x, y) => x.value.localeCompare(y.value));

// Rewrite
await Deno.writeTextFile(new URL(window.source.name, base), webidl.write(astMap.get(window.source.name)));

const confUrl = new URL("../../gecko-dev/dom/base/UseCounters.conf", import.meta.url);
const conf = await Deno.readTextFile(confUrl);

const start = conf.indexOf("method Window.");
const end = conf.indexOf('\n\n', start);

const newWindowProps = instrumentedProps.map(p => `method Window.${p.value}`).join("\n");
const newConf = conf.slice(0, start) + newWindowProps + conf.slice(end);

await Deno.writeTextFile(confUrl, newConf);
