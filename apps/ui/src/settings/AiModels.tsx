import type { AgentNameValue, AiStatusValue, ApiModelValue, KeyedProviderValue } from "@clipcat/ipc";
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { bridge } from "../bridge";
import { ICON_STROKE } from "../icons";
import { type Ai, readiness } from "../project/useAi";
import { AgentCli } from "./AgentCli";
import { Group } from "./Group";

const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

type Cli = "claude" | "codex";
type Keyed = "api" | KeyedProviderValue;

/** The ways to run the AI editor, as the page groups them. */
const PLANS: Cli[] = ["claude", "codex"];
const KEYS: Keyed[] = ["api", "openai", "openrouter"];

export const PROVIDER_LABEL: Record<AgentNameValue, string> = { claude: "Claude Code", codex: "Codex", api: "Claude API", openai: "OpenAI", openrouter: "OpenRouter" };

/** What each one is, in a sentence. */
const WHAT: Record<AgentNameValue, string> = {
  claude: "Runs the claude command on this computer, on your Claude plan.",
  codex: "Runs the codex command on this computer, on your ChatGPT plan.",
  api: "Calls the Claude API. Each run is billed to your Anthropic account.",
  openai: "Calls the OpenAI API with GPT models. Each run is billed to your OpenAI account.",
  openrouter: "Calls any model OpenRouter serves that can use tools. Each run is billed to your OpenRouter credit. Results vary by model.",
};

/** Where to get a key, and what one starts with. */
const KEY_HELP: Record<Keyed, { site: string; placeholder: string }> = {
  api: { site: "console.anthropic.com", placeholder: "sk-ant-…" },
  openai: { site: "platform.openai.com", placeholder: "sk-…" },
  openrouter: { site: "openrouter.ai/keys", placeholder: "sk-or-…" },
};

export const API_MODEL_LABEL: Record<ApiModelValue, string> = {
  "claude-opus-5-5": "Opus 5.5 (best)",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-haiku-5-5": "Haiku 5.5 (cheapest)",
};

/** What the empty choice means: the CLI's own default, named when the CLI says which. */
function defaultModelLabel(ai: AiStatusValue, name: Cli): string {
  const fallback = ai.models[name].fallback;
  return `${PROVIDER_LABEL[name]} default${fallback ? ` (${fallback})` : ""}`;
}

/** The models to offer, with a picked one that has since left the list kept in it. */
function withSelected(choices: { id: string; label: string }[], selected: string | null): { id: string; label: string }[] {
  return selected && !choices.some((c) => c.id === selected) ? [...choices, { id: selected, label: selected }] : choices;
}

const hasKey = (ai: AiStatusValue, name: Keyed) => (name === "api" ? ai.api.hasKey : ai[name].hasKey);

/** One line on whether it can run now. */
function stateText(ai: AiStatusValue, name: AgentNameValue): string {
  const s = readiness(ai, name);
  if (name === "claude" || name === "codex") return s.ready ? "Signed in and ready." : (s.detail ?? "Not ready.");
  if (!hasKey(ai, name)) return `Needs a key from ${KEY_HELP[name].site}.`;
  return s.ready ? "Key saved, encrypted on this computer." : (s.detail ?? "Not ready.");
}

/** A few words for the Settings list: which one runs the AI editor, and whether it can. */
export function aiShort(ai: AiStatusValue | null): string {
  if (!ai) return "Checking…";
  return `${PROVIDER_LABEL[ai.agent]}${readiness(ai, ai.agent).ready ? "" : ", not set up"}`;
}

/** A saved key's Remove button, or the field to paste one into. */
function KeyField({ name, saved, onSave }: { name: Keyed; saved: boolean; onSave: (key: string | null) => Promise<void> }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const save = (next: string | null) => {
    setSaving(true);
    onSave(next)
      // The page shows why a key was refused, so the field just keeps it for fixing.
      .then(() => setKey(""), () => {})
      .finally(() => setSaving(false));
  };
  if (saved) {
    return (
      <div className="provider__key">
        <button type="button" className="button" disabled={saving} aria-label={`Remove ${PROVIDER_LABEL[name]} key`} onClick={() => save(null)}>
          <Trash2 className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          Remove key
        </button>
      </div>
    );
  }
  return (
    <div className="provider__key">
      <input
        className="field__control provider__key-input"
        type="password"
        autoComplete="off"
        aria-label={`${PROVIDER_LABEL[name]} key`}
        placeholder={KEY_HELP[name].placeholder}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button
        type="button"
        className="button"
        disabled={saving || key.trim().length < 10}
        aria-label={`Save ${PROVIDER_LABEL[name]} key`}
        onClick={() => save(key.trim())}
      >
        <KeyRound className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
        {saving ? "Checking…" : "Save key"}
      </button>
    </div>
  );
}

/**
 * The AI editor's page in Settings: which AI runs it, each one's model,
 * the keys for the APIs, and the Claude Code and Codex command-line tools.
 * The Edit tab only picks among these.
 */
export function AiModels({ ai: shared }: { ai: Ai }) {
  const { status: ai, setStatus: setAi, check } = shared;
  const [failure, setError] = useState<string | null>(null);
  const error = failure ?? shared.error;

  const fail = (e: unknown) => setError(message(e));
  const choose = (next: AgentNameValue) => {
    setError(null);
    setAi((prev) => (prev ? { ...prev, agent: next } : prev));
    bridge()?.invoke("settings:set", { agent: next }).catch(fail);
  };
  const chooseApiModel = (model: ApiModelValue) => {
    setAi((prev) => (prev ? { ...prev, api: { ...prev.api, model } } : prev));
    bridge()?.invoke("settings:set", { apiModel: model }).catch(fail);
  };
  const chooseCliModel = (name: Cli, model: string | null) => {
    setAi((prev) => (prev ? { ...prev, models: { ...prev.models, [name]: { ...prev.models[name], selected: model } } } : prev));
    bridge()
      ?.invoke("settings:set", name === "codex" ? { codexModel: model } : { claudeModel: model })
      .catch(fail);
  };
  const chooseProviderModel = (name: KeyedProviderValue, model: string | null) => {
    setAi((prev) => (prev ? { ...prev, [name]: { ...prev[name], model } } : prev));
    bridge()
      ?.invoke("settings:set", name === "openai" ? { openaiModel: model } : { openrouterModel: model })
      .catch(fail);
  };
  const saveKey = async (name: Keyed, key: string | null) => {
    setError(null);
    const api = bridge();
    if (!api) return;
    try {
      if (name === "api") {
        const status = await api.invoke("settings:api-key", { key });
        setAi((prev) => (prev ? { ...prev, api: status } : prev));
      } else {
        const status = await api.invoke("settings:provider-key", { provider: name, key });
        setAi((prev) => (prev ? { ...prev, [name]: status } : prev));
      }
    } catch (e) {
      fail(e);
      throw e;
    }
  };

  /** A provider's row: its radio and name, whether it can run, then whatever it needs set. */
  const row = (name: AgentNameValue, extra: ReactNode, action?: ReactNode) => {
    const ready = ai ? readiness(ai, name).ready : false;
    return (
      <li key={name} className="agents__item">
        <div className="agents__row">
          <label className="provider__pick">
            <input type="radio" name="ai-provider" checked={ai?.agent === name} disabled={!ai} onChange={() => choose(name)} />
            <span className="agents__text">
              <span className="agents__name">{PROVIDER_LABEL[name]}</span>
              <span className={ready || ai?.agent !== name ? "agents__state" : "agents__state provider__state--off"} role="status">
                {ai ? stateText(ai, name) : "Checking…"}
              </span>
              <span className="agents__path">{WHAT[name]}</span>
            </span>
          </label>
          {action}
        </div>
        {ai && <div className="provider__more">{extra}</div>}
      </li>
    );
  };

  const modelField = (label: string, value: string, onChange: (value: string) => void, options: ReactNode) => (
    <div className="fields">
      <label className="field">
        <span className="field__label">Model</span>
        <select className="field__control" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          {options}
        </select>
      </label>
    </div>
  );

  const cliExtra = (name: Cli) =>
    ai && (
      <>
        {modelField(
          `${PROVIDER_LABEL[name]} model`,
          ai.models[name].selected ?? "",
          (v) => chooseCliModel(name, v || null),
          <>
            <option value="">{defaultModelLabel(ai, name)}</option>
            {withSelected(ai.models[name].choices, ai.models[name].selected).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </>,
        )}
        <AgentCli cli={name} />
      </>
    );

  const keyedExtra = (name: Keyed) => {
    if (!ai) return null;
    let models: ReactNode = null;
    if (name === "api") {
      models = modelField(
        "Claude API model",
        ai.api.model,
        (v) => chooseApiModel(v as ApiModelValue),
        (Object.keys(API_MODEL_LABEL) as ApiModelValue[]).map((m) => (
          <option key={m} value={m}>
            {API_MODEL_LABEL[m]}
          </option>
        )),
      );
    } else if (ai[name].hasKey) {
      const { model, choices } = ai[name];
      models = modelField(
        `${PROVIDER_LABEL[name]} model`,
        model ?? "",
        (v) => chooseProviderModel(name, v || null),
        <>
          {model === null && <option value="">Pick a model</option>}
          {withSelected(choices, model).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </>,
      );
    }
    return (
      <>
        {models}
        {name !== "api" && ai[name].hasKey && ai[name].choices.length === 0 && (
          <p className="settings__hint ai__row">
            <span>Couldn't load the list of models. Check the connection and the key.</span>
            <button type="button" className="button" onClick={check}>
              <RefreshCw className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
              Check again
            </button>
          </p>
        )}
        <KeyField name={name} saved={hasKey(ai, name)} onSave={(key) => saveKey(name, key)} />
      </>
    );
  };

  const checkAgain = (name: Cli) =>
    ai &&
    !readiness(ai, name).ready && (
      <div className="agents__actions">
        <button type="button" className="button" aria-label={`Check ${PROVIDER_LABEL[name]} again`} onClick={check}>
          <RefreshCw className="icon-sm" strokeWidth={ICON_STROKE} aria-hidden />
          Check again
        </button>
      </div>
    );

  return (
    <>
      <Group id="ai-plans-title" label="On your plan">
        <p className="settings__hint">Pick one AI on this page. It suggests edits, shorts, the write-up and spelling fixes in every project.</p>
        <ul className="agents" aria-label="AI on your plan">
          {PLANS.map((name) => row(name, cliExtra(name), checkAgain(name)))}
        </ul>
      </Group>
      <Group id="ai-keys-title" label="With your own key">
        <p className="settings__hint">ClipCat tries a key with one call before saving it, then keeps it encrypted with your system's keychain.</p>
        <ul className="agents" aria-label="AI with your own key">
          {KEYS.map((name) => row(name, keyedExtra(name)))}
        </ul>
      </Group>
      {error && (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
