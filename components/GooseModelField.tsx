"use client";

// The model field of a provider's row: a fixed list of the provider's models, or a text box with those
// models as suggestions.
//
// A gateway behind a provider's API serves its own model ids, so the field is a text box when the
// provider takes any id, and a list only when the ids are known up front.

const INPUT_CLASS =
  "w-full rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent";

export interface GooseModelFieldProps {
  providerId: string;
  providerLabel: string;
  model: string;
  // The models this provider offers; empty means the user types one.
  models: string[];
  // True when the provider takes any model id.
  freeModel?: boolean;
  onModel: (providerId: string, model: string) => void;
}

export default function GooseModelField({
  providerId,
  providerLabel,
  model,
  models,
  freeModel = false,
  onModel,
}: GooseModelFieldProps) {
  const known = models.length > 0 && !freeModel;
  return (
    <label className="flex items-center gap-2">
      <span className="w-[70px] shrink-0 text-[11.5px] text-muted">Model</span>
      {known ? (
        <select
          value={model}
          onChange={(e) => onModel(providerId, e.target.value)}
          aria-label={`${providerLabel} model`}
          className="rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent"
        >
          <option value="">Provider default</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            type="text"
            value={model}
            onChange={(e) => onModel(providerId, e.target.value)}
            placeholder="Type the model id"
            aria-label={`${providerLabel} model`}
            spellCheck={false}
            list={models.length > 0 ? `${providerId}-models` : undefined}
            className={INPUT_CLASS}
          />
          {models.length > 0 && (
            <datalist id={`${providerId}-models`}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
        </>
      )}
    </label>
  );
}
