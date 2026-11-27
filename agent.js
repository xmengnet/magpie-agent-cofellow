/**
 * Magpie agent plugin: CoFellow
 *
 * CoFellow reads ~/.cofellow/config.json and hot-reloads it when an external
 * tool rewrites the file. This plugin gives Magpie the one thing it needs to
 * drive that file:
 *
 *   1. a provider object at `provider.magpie` (all of Magpie's models, with
 *      CoFellow's metadata), leaving every other provider untouched;
 *   2. a `selection` pointing at that provider, so CoFellow resolves it;
 *   3. a `model` section, so a cold start uses the same model before any
 *      hot-reload happens (`model.modelName` itself is written by Magpie).
 *
 * On unwire Magpie removes `provider.magpie` and restores `selection` /
 * `model`, which puts CoFellow back on its own provider.
 *
 * Runs in moejs inside Magpie's own process: no Node APIs, no timers, no
 * imports outside this package. Keep it that way.
 */

const PROVIDER_ID = "magpie";
const CONFIG_PATH = "~/.cofellow/config.json";
// magpie fetches an https icon and keeps it; it must be a public host.
const ICON_URL =
  "https://raw.githubusercontent.com/xmengnet/magpie-agent-cofellow/main/icon.png";

/** The highest reasoning level a Magpie model offers, "" when none. */
function highestEffort(efforts) {
  if (!Array.isArray(efforts) || efforts.length === 0) return "";
  return efforts[efforts.length - 1];
}

/** One Magpie model as CoFellow's `models.<id>` object. */
function modelSpec(model) {
  const spec = {
    name: model.name || model.id,
    contextWindow: model.context || 0,
    maxOutputTokens: model.output || 0,
    supportsVision: !!model.images,
    supportsTools: true,
    enabled: true,
  };
  if (Array.isArray(model.efforts) && model.efforts.length > 0) {
    spec.reasoningLevels = [...model.efforts];
  }
  return spec;
}

/** Magpie's models keyed by id, as CoFellow's provider object wants them. */
function modelMap(models) {
  const out = {};
  for (const model of models) {
    if (!model || !model.id) continue;
    out[model.id] = modelSpec(model);
  }
  return out;
}

/** The whole `provider.magpie` value. */
function buildProvider(gateway, models) {
  return {
    name: "magpie",
    protocol: "openai",
    baseUrl: gateway.v1,
    apiKey: gateway.key,
    enabled: true,
    models: modelMap(models),
  };
}

/**
 * Magpie calls this whenever its model for CoFellow changes.
 *
 * The returned object is a set of key paths; Magpie writes each one into
 * ~/.cofellow/config.json, stashes what was there, and puts it back when the
 * user takes Magpie out. `model.modelName` is written by Magpie itself.
 */
export function connect({ gateway, model, models }) {
  const all = Array.isArray(models) && models.length > 0
    ? models
    : (model && model.id ? [model] : []);
  const current = model && model.id ? model : (all[0] || null);

  const out = {
    // One provider entry, not the whole `provider` map: user providers stay.
    [`provider.${PROVIDER_ID}`]: buildProvider(gateway, all),

    // Cold start: Runtime.NewRuntime builds its client from `model` before
    // any hot-reload callback runs.
    "model.baseUrl": gateway.v1,
    "model.apiKey": gateway.key,
    "model.providerId": PROVIDER_ID,
    "model.protocol": "openai",
    "model.supportsTools": true,
  };

  if (current) {
    out.selection = {
      providerId: PROVIDER_ID,
      modelId: current.id,
      reasoningLevel: highestEffort(current.efforts),
    };
    if (current.context) out["model.contextWindow"] = current.context;
    if (current.output) {
      out["model.maxOutputTokens"] = current.output;
      // Runtime's request builder reads maxTokens; keep both in sync.
      out["model.maxTokens"] = current.output;
    }
    // Always written, never only when true: a model that takes no image must
    // clear a `true` left by the model it replaced, or CoFellow keeps sending
    // images to a model that refuses them.
    out["model.supportsVision"] = !!current.images;
    if (Array.isArray(current.efforts) && current.efforts.length > 0) {
      out["model.reasoningLevels"] = [...current.efforts];
      out["model.reasoningLevel"] = highestEffort(current.efforts);
    }
  }
  return out;
}

/**
 * CoFellow's own models for Magpie's model picker.
 *
 * Given the parsed config, list every enabled model of every provider except
 * Magpie's. `value` is what Magpie writes into `model.modelName`; `direct` is
 * the vendor name the picker groups by.
 *
 * Magpie's own-model write restores `selection` and the rest of `model` first.
 * CoFellow honors that write when the pick belongs to the selected provider;
 * switching between CoFellow providers is done by taking Magpie out.
 */
export function own({ config }) {
  const providers = config && config.provider;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return [];
  }

  const out = [];
  for (const [providerID, provider] of Object.entries(providers)) {
    if (providerID === PROVIDER_ID || !provider) continue;
    if (provider.enabled === false) continue;
    const models = provider.models;
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    for (const [modelID, model] of Object.entries(models)) {
      if (!model || model.enabled === false) continue;
      out.push({
        value: modelID,
        model: model.name || modelID,
        direct: provider.name || providerID,
      });
    }
  }
  return out;
}

export const agent = {
  id: "cofellow",
  name: "CoFellow",
  config: CONFIG_PATH,
  format: "json",
  // A picture for its row on the Agents page. magpie reads the icon from the
  // agent export, not from package.json's magpie.icon (that one is the
  // plugin's card in Discover), and falls back to a generic glyph without it.
  icon: ICON_URL,
  // The key the model is written to; Magpie writes `model.modelName`.
  model: "model.modelName",
  bin: "cofellow",
  dir: "~/.cofellow",
  // CoFellow's User-Agent is "CoFellow/<version>".
  ua: ["cofellow"],
  notice: "CoFellow hot-reloads ~/.cofellow/config.json, so no restart is needed.",
  library: {
    instructions: "~/.cofellow/AGENTS.md",
    skills: "~/.cofellow/skills",
    // CoFellow keeps MCP servers in the same config.json, under mcpServers.
    // Magpie writes one server per key and leaves the rest of the file alone.
    mcp: CONFIG_PATH,
    mcpFormat: "claude",
  },
};

// Magpie loads `_internal` for tests; it is not a plugin (not a function).
export const _internal = {
  PROVIDER_ID,
  CONFIG_PATH,
  ICON_URL,
  highestEffort,
  modelSpec,
  modelMap,
  buildProvider,
  connect,
  own,
};