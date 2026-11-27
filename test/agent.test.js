import { describe, expect, test } from "bun:test";
import { _internal, agent } from "../agent.js";

const gateway = { url: "http://127.0.0.1:3425", v1: "http://127.0.0.1:3425/v1", key: "test" + "key" };
const chat = {
  id: "deepseek/deepseek-chat",
  name: "DeepSeek Chat",
  context: 128000,
  output: 8192,
  images: false,
  efforts: ["low", "medium", "high"],
};
const reasoner = {
  id: "deepseek/deepseek-reasoner",
  name: "DeepSeek Reasoner",
  context: 128000,
  output: 64000,
  images: false,
  efforts: ["low", "high"],
};

describe("agent description", () => {
  test("points at CoFellow's config and model key", () => {
    expect(agent.id).toBe("cofellow");
    expect(agent.config).toBe("~/.cofellow/config.json");
    expect(agent.model).toBe("model.modelName");
    expect(agent.bin).toBe("cofellow");
    expect(agent.ua).toEqual(["cofellow"]);
  });

  test("gives its Agents-page row a picture", () => {
    // magpie reads agent.icon for the row; package.json's magpie.icon is the
    // plugin's card in Discover and never reaches the row.
    expect(agent.icon).toBe(_internal.ICON_URL);
    expect(agent.icon).toMatch(/^https:\/\//);
  });

  test("wires the Library into CoFellow's own files", () => {
    expect(agent.library.instructions).toBe("~/.cofellow/AGENTS.md");
    expect(agent.library.skills).toBe("~/.cofellow/skills");
    expect(agent.library.mcp).toBe("~/.cofellow/config.json");
    expect(agent.library.mcpFormat).toBe("claude");
  });
});

describe("connect", () => {
  const out = _internal.connect({ gateway, model: chat, models: [chat, reasoner] });

  test("writes one provider key, not the whole provider map", () => {
    expect(Object.keys(out)).toContain("provider.magpie");
    expect(out["provider.magpie"]).toBeDefined();
    expect(out).not.toHaveProperty("provider");
  });

  test("provider has every Magpie model, keyed by id, and no internal id field", () => {
    const provider = out["provider.magpie"];
    expect(provider.name).toBe("magpie");
    expect(provider.protocol).toBe("openai");
    expect(provider.baseUrl).toBe(gateway.v1);
    expect(provider.apiKey).toBe(gateway.key);
    expect(provider.enabled).toBe(true);
    expect(Object.keys(provider.models)).toEqual([chat.id, reasoner.id]);
    expect(provider.models[chat.id].name).toBe("DeepSeek Chat");
    expect(provider.models[chat.id].contextWindow).toBe(128000);
    expect(provider.models[chat.id].maxOutputTokens).toBe(8192);
    expect(provider.models[chat.id].supportsTools).toBe(true);
    expect(provider.models[chat.id].reasoningLevels).toEqual(["low", "medium", "high"]);
    expect(provider.models[chat.id]).not.toHaveProperty("id");
  });

  test("selection points at the chosen model", () => {
    expect(out.selection).toEqual({
      providerId: "magpie",
      modelId: chat.id,
      reasoningLevel: "high",
    });
  });

  test("model section makes a cold start use the gateway too", () => {
    expect(out["model.baseUrl"]).toBe(gateway.v1);
    expect(out["model.apiKey"]).toBe(gateway.key);
    expect(out["model.providerId"]).toBe("magpie");
    expect(out["model.protocol"]).toBe("openai");
    expect(out["model.contextWindow"]).toBe(128000);
    expect(out["model.maxOutputTokens"]).toBe(8192);
    expect(out["model.maxTokens"]).toBe(8192);
    expect(out["model.supportsTools"]).toBe(true);
    expect(out["model.reasoningLevels"]).toEqual(["low", "medium", "high"]);
    expect(out["model.reasoningLevel"]).toBe("high");
    // Magpie writes model.modelName itself.
    expect(out).not.toHaveProperty("model.modelName");
  });

  test("writes supportsVision even when the model takes no image", () => {
    // A true left behind would keep CoFellow sending images to a text-only
    // model, which some vendors answer 400 to.
    const out = _internal.connect({ gateway, model: chat, models: [chat] });
    expect(out["model.supportsVision"]).toBe(false);
  });

  test("a vision model sets it true and the per-model entry agrees", () => {
    const seen = { ...chat, id: "x/vision", images: true };
    const out = _internal.connect({ gateway, model: seen, models: [seen] });
    expect(out["model.supportsVision"]).toBe(true);
    expect(out["provider.magpie"].models["x/vision"].supportsVision).toBe(true);
  });

  test("does not mutate the input", () => {
    expect(chat.efforts).toEqual(["low", "medium", "high"]);
    expect(chat).not.toHaveProperty("contextWindow");
  });

  test("falls back to the first offered model when none is current", () => {
    const empty = _internal.connect({ gateway, model: { id: "" }, models: [chat] });
    expect(empty["provider.magpie"].models[chat.id]).toBeDefined();
    expect(empty.selection.modelId).toBe(chat.id);
  });

  test("writes the provider even when no model is known at all", () => {
    const none = _internal.connect({ gateway, model: { id: "" }, models: [] });
    expect(none["provider.magpie"]).toBeDefined();
    expect(none).not.toHaveProperty("selection");
  });
});

describe("own", () => {
  const config = {
    provider: {
      deepseek: {
        name: "DeepSeek",
        enabled: true,
        models: {
          "deepseek-chat": { name: "DeepSeek Chat", enabled: true },
          "deepseek-reasoner": { name: "DeepSeek Reasoner", enabled: false },
        },
      },
      kimi: {
        name: "Kimi",
        enabled: true,
        models: { "kimi-k2": { name: "Kimi K2" } },
      },
      disabled: {
        name: "Disabled",
        enabled: false,
        models: { hidden: {} },
      },
      magpie: {
        name: "magpie",
        enabled: true,
        models: { "deepseek/deepseek-chat": {} },
      },
    },
  };

  test("lists user models, skipping Magpie and disabled entries", () => {
    expect(_internal.own({ config })).toEqual([
      { value: "deepseek-chat", model: "DeepSeek Chat", direct: "DeepSeek" },
      { value: "kimi-k2", model: "Kimi K2", direct: "Kimi" },
    ]);
  });

  test("tolerates a missing or legacy config", () => {
    expect(_internal.own({ config: undefined })).toEqual([]);
    expect(_internal.own({ config: { provider: [] } })).toEqual([]);
  });
});

describe("highestEffort", () => {
  test("uses the last level Magpie lists", () => {
    expect(_internal.highestEffort(["low", "high"])).toBe("high");
    expect(_internal.highestEffort([])).toBe("");
    expect(_internal.highestEffort(undefined)).toBe("");
  });
});