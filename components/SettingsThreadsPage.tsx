// The Threads page: the keep-conversations-open select and the thread-instructions textarea (with a
// reset-to-default button). The default permission mode lives on Security.
import { KEEP_ALIVE } from "@/lib/settings-shared";
import { SELECT_CLASS } from "./ModelSelect";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";

export default function SettingsThreadsPage({
  keepAlive,
  setKeepAlive,
  prompt,
  setPrompt,
  defaultThreadPrompt,
  isDefaultPrompt,
  clearSaveError,
}: {
  keepAlive: number;
  setKeepAlive: (next: number) => void;
  prompt: string;
  setPrompt: (next: string) => void;
  defaultThreadPrompt: string;
  isDefaultPrompt: boolean;
  clearSaveError: () => void;
}) {
  // A custom keepAlive value goes onto the menu as a "(N) minutes" line, so the user's pick survives Save.
  const keepAliveOptions = KEEP_ALIVE.some((o) => o.minutes === keepAlive)
    ? KEEP_ALIVE
    : [...KEEP_ALIVE, { minutes: keepAlive, label: `${keepAlive} minutes` }];

  return (
    <>
      <SettingsCard>
        <section className="flex items-center justify-between gap-4">
          <SettingsSectionHeader
            title="Keep conversations open"
            hint={`A thread's CLI stays open between messages so replies start right away.`}
          />
          <select
            value={keepAlive}
            aria-label="Keep conversations open"
            onChange={(e) => {
              setKeepAlive(Number(e.target.value));
              clearSaveError();
            }}
            className={SELECT_CLASS}
          >
            {keepAliveOptions.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </section>
      </SettingsCard>
      <SettingsCard>
        <section className="flex flex-col gap-2">
          <SettingsSectionHeader
            title="Thread instructions"
            hint={`Added to every thread's system prompt. The board reads the BOARD STATUS line it asks for, so keep that line's format.`}
          />
          <textarea
            rows={18}
            value={prompt}
            spellCheck={false}
            aria-label="Thread instructions"
            onChange={(e) => {
              setPrompt(e.target.value);
              clearSaveError();
            }}
            className="w-full resize-y rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
          />
          <div className="flex items-start justify-between gap-4">
            <p className="text-[12px] text-faint">
              Takes effect for threads that start after you save; threads already open keep their instructions.
            </p>
            <button
              onClick={() => setPrompt(defaultThreadPrompt)}
              disabled={isDefaultPrompt}
              className="shrink-0 text-[12.5px] text-accent hover:underline disabled:text-faint disabled:no-underline"
            >
              Reset to default
            </button>
          </div>
        </section>
      </SettingsCard>
    </>
  );
}