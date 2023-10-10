import * as webidl from "npm:gecko-webidl@1.0.1";
import bcd from "npm:bcd-idl-mapper@2.2.2";
import { lacksOnlyGeckoSupport, lacksOthersSupport } from "../lib/support.ts";
import {
  getExposedGlobals,
  getInstrumentedPropsExtendedAttr,
  getStandardInterfaceDefinitions,
  hasIndexedOrNamedGetter,
  iterateGeckoIdls,
} from "../lib/idl.ts";

class EntriesMap {
  #map = new Map<string, string[]>();
  get(key: string) {
    return this.#map.get(key);
  }
  add(key: string, value: string) {
    const list = this.get(key) ?? [];
    list.push(value);
    this.#map.set(key, list);
  }
  entries() {
    return this.#map.entries();
  }
}

const standardInterfacesMap = await getStandardInterfaceDefinitions();

// Get missing entries
const missingEntriesMap = new EntriesMap();

for (const [interfaceName, interfaceData] of Object.entries(bcd)) {
  // Global interfaces
  if (
    interfaceName.startsWith("_") ||
    // WebGL never exposes interfaces
    interfaceName.startsWith("EXT_") ||
    interfaceName.startsWith("KHR_") ||
    interfaceName.startsWith("OES_") ||
    interfaceName.startsWith("WEBGL_")
  ) {
    continue;
  }
  if (lacksOthersSupport(interfaceData.__compat.support)) {
    continue;
  }
  if (lacksOnlyGeckoSupport(interfaceData.__compat.support)) {
    const standardIdl = standardInterfacesMap.get(interfaceName);
    if (!standardIdl) {
      console.warn("Skipping nonstandard interface", interfaceName);
      continue;
    }
    if (getExposedGlobals(standardIdl).includes("Window")) {
      missingEntriesMap.add("Window", interfaceName);
    }
    // TODO: workers?
    continue;
  }

  // Interface members
  for (const [memberName, memberData] of Object.entries(interfaceData)) {
    if (
      memberName.includes("_") || // IDL members almost never include underscore; this is non-IDL metadata
      memberName === interfaceName // Constructor always exists so can't be instrumented
    ) {
      continue;
    }
    if (memberData.__compat.description?.startsWith("An alternative name of")) {
      console.warn(
        `Skipping ${interfaceName}.${memberName}, for now the BCD alternative name data is not reliable enough`
      );
      continue;
    }
    if (lacksOnlyGeckoSupport(memberData.__compat.support)) {
      missingEntriesMap.add(interfaceName, memberName);
    }
  }
}

// Iterate the webidl directory
const base = new URL("../../gecko-dev/dom/webidl/", import.meta.url);
const astMap = new Map<string, any>();
const interfaceMap = new Map<string, any>();
for await (const { fileName, ast } of iterateGeckoIdls(base)) {
  // Collect interfaces and ASTs to rewrite later
  const interfaces = ast.filter((i) => i.type === "interface" && !i.partial);
  for (const i of interfaces) {
    interfaceMap.set(i.name, i);
  }
  astMap.set(fileName, ast);
}

for (const [key, entries] of missingEntriesMap.entries()) {
  const targetInterfaceIdl = interfaceMap.get(key);
  if (!targetInterfaceIdl) {
    continue;
  }
  if (
    !hasIndexedOrNamedGetter(targetInterfaceIdl) &&
    // Document has indexers in HTMLDocument, Location has cross origin members
    !["Document", "Location"].includes(targetInterfaceIdl.name)
  ) {
    console.warn(`Skipping ${targetInterfaceIdl.name} as it's not proxy based`);
    continue;
  }

  // XXX: create [InstrumentedProps] if not exists
  const instrumentedProps =
    getInstrumentedPropsExtendedAttr(targetInterfaceIdl);
  if (!instrumentedProps) {
    insertEmptyInstrumentedProps(targetInterfaceIdl, entries);
  } else {
    const filteredEntries = entries.filter(
      (entry) => !instrumentedProps.find((p) => p.value === entry)
    );
    if (!filteredEntries.length) {
      continue;
    }

    for (const entry of entries) {
      // Skip already existing props
      if (instrumentedProps.find((p) => p.value === entry)) {
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
  }
  await Deno.writeTextFile(
    new URL(targetInterfaceIdl.source.name, base),
    webidl.write(astMap.get(targetInterfaceIdl.source.name))
  );
}

const confUrl = new URL(
  "../../gecko-dev/dom/base/UseCounters.conf",
  import.meta.url
);
const conf = await Deno.readTextFile(confUrl);

const startMarker =
  "// them and we only need one use counter, not a getter/setter pair.";
const start = conf.indexOf(startMarker) + startMarker.length + 1;
const end = conf.indexOf("\n\n", start);

const existingConfEntries = new Set(conf.slice(start, end).split("\n"));
const newProps: string[] = [...missingEntriesMap.entries()].flatMap(
  ([key, entries]) => entries.map((entry) => `method ${key}.${entry}`)
);
for (const prop of newProps) {
  existingConfEntries.add(prop);
}
const newConf =
  conf.slice(0, start) +
  [...existingConfEntries].sort((x, y) => x.localeCompare(y)).join("\n") +
  conf.slice(end);

await Deno.writeTextFile(confUrl, newConf);

function insertEmptyInstrumentedProps(i, entries: string[]) {
  // XXX: webidl2.js currently has no way to create AST item
  const dummyInterface = webidl.parse(`
[Exposed=Window,
 InstrumentedProps=(Dummy,
                    Dummy)]
 interface Foo {};
`)[0];
  const [exposed, instrumentedProps] = dummyInterface.extAttrs;
  const list = instrumentedProps.rhs.value;
  const dummy = list[0];
  const trivia = list[1].tokens.value.trivia;
  list.length = 0;
  for (const entry of entries.toSorted()) {
    const tokens = { ...dummy.tokens };
    tokens.value = { ...dummy.tokens.value, value: entry };
    if (list.length) {
      tokens.value.trivia = trivia;
    }
    const prop = new dummy.constructor({ tokens });
    list.push(prop);
  }
  list.at(-1).tokens.separator = undefined;
  i.extAttrs.at(-1).tokens.separator = exposed.tokens.separator;
  i.extAttrs.push(instrumentedProps);
}
