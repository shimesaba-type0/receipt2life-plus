import { useEffect, useRef, useState } from "preact/hooks";
import type { AccountView, ApiResult } from "../../../src/api/contract";
import { addAccount, deleteAccount, getAccounts, updateAccount } from "../api";
import { accountMoveTargets, checkAccountRename, checkNewAccount, defaultAccountMoveTarget, needsOtherAccount } from "./accountsLogic";
import { errorText, usageLabel } from "./categoriesLogic";

// いま開いているフォーム(同時に1つだけ)
type Mode = { kind: "none" } | { kind: "edit"; name: string } | { kind: "add" };

function useFocusOnOpen() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

// 支払方法(口座)の管理。カテゴリのカードと同じ見た目・操作(クラスは Categories.css の cat__*)
export function AccountsSection() {
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function load() {
    try {
      const res = await getAccounts();
      if (res.ok) {
        setAccounts(res.accounts);
        setLoadError(null);
      } else {
        setLoadError(errorText(res.errors));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // 変更を1件ずつ実行する(二重送信を防ぐ)。成功したらお知らせを出してフォームを閉じ、一覧を読み直す
  async function act<T extends { message: string }>(call: () => Promise<ApiResult<T>>): Promise<string | null> {
    if (busyRef.current) return "処理中です。少し待ってください。";
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const res = await call();
      if (!res.ok) return errorText(res.errors);
      setNotice(res.message);
      setMode({ kind: "none" });
      await load();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "通信に失敗しました。";
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const open = (m: Mode) => {
    setNotice(null);
    setMode(m);
  };
  const close = () => setMode({ kind: "none" });

  return (
    <section class="cat__card cat__accounts" aria-labelledby="cat-accounts-heading">
      <header class="cat__card-head">
        <h2 id="cat-accounts-heading" class="cat__group">
          登録されている支払方法
        </h2>
      </header>
      <p class="muted cat__hint">現金・カードなど、支出の支払方法です。AI(Claude など)が登録するときは、ここにある名前から選びます。</p>

      {notice && (
        <p class="cat__notice" role="status">
          {notice}
        </p>
      )}
      {accounts === null && loadError === null && (
        <p class="muted cat__status" role="status">
          読み込み中です…
        </p>
      )}
      {loadError !== null && (
        <div class="cat__status" role="alert">
          <p class="error">{loadError}</p>
          <button type="button" class="btn" onClick={() => void load()}>
            もう一度読み込む
          </button>
        </div>
      )}

      {accounts !== null && (
        <>
          <ul class="cat__list">
            {accounts.map((a) => {
              const editing = mode.kind === "edit" && mode.name === a.name;
              return (
                <li key={a.name} class={`cat__row${editing ? " is-editing" : ""}`}>
                  {editing ? (
                    <EditAccountForm
                      account={a}
                      accounts={accounts}
                      busy={busy}
                      onSave={(newName) => act(() => updateAccount(a.name, { new_name: newName }))}
                      onDelete={(moveTo) => act(() => deleteAccount(a.name, moveTo))}
                      onCancel={close}
                    />
                  ) : (
                    <>
                      <span class="cat__name">{a.name}</span>
                      <span class={`cat__usage num${a.usage === 0 ? " is-zero" : ""}`}>{usageLabel(a.usage)}</span>
                      <button type="button" class="cat__link" aria-label={`支払方法「${a.name}」を編集`} onClick={() => open({ kind: "edit", name: a.name })}>
                        編集
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {mode.kind === "add" ? (
            <AddAccountForm accounts={accounts} busy={busy} onSubmit={(name) => act(() => addAccount({ name }))} onCancel={close} />
          ) : (
            <button type="button" class="cat__add" onClick={() => open({ kind: "add" })}>
              <span aria-hidden="true">＋</span> 支払方法を追加
            </button>
          )}
        </>
      )}
    </section>
  );
}

function FormError(props: { message: string | null }) {
  return props.message ? (
    <p class="error cat__error" role="alert">
      {props.message}
    </p>
  ) : null;
}

function FormButtons(props: { busy: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <div class="cat__actions">
      <button type="submit" class="btn btn--primary" disabled={props.busy}>
        {props.busy ? "保存中…" : props.submitLabel}
      </button>
      <button type="button" class="btn" disabled={props.busy} onClick={props.onCancel}>
        キャンセル
      </button>
    </div>
  );
}

function AddAccountForm(props: { accounts: AccountView[]; busy: boolean; onSubmit: (name: string) => Promise<string | null>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useFocusOnOpen();

  async function submit(e: Event) {
    e.preventDefault();
    const check = checkNewAccount(props.accounts, name);
    if (!check.ok) return setError(check.error);
    setError(null);
    setError(await props.onSubmit(check.value));
  }

  return (
    <form class="cat__form" onSubmit={submit} aria-label="支払方法を追加">
      <label for="acc-add-name">支払方法の名前</label>
      <input id="acc-add-name" ref={ref} type="text" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} autocomplete="off" />
      <p class="muted cat__hint">「現金」と「げんきん」のような表記ゆれで増やさないよう、既にある名前を確かめてください。</p>
      <FormError message={error} />
      <FormButtons busy={props.busy} submitLabel="追加" onCancel={props.onCancel} />
    </form>
  );
}

function EditAccountForm(props: {
  account: AccountView;
  accounts: AccountView[];
  busy: boolean;
  onSave: (newName: string) => Promise<string | null>;
  onDelete: (moveTo?: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const { account, accounts, busy } = props;
  const [newName, setNewName] = useState(account.name);
  const [error, setError] = useState<string | null>(null);
  // 削除は2段階: 「削除…」で確認を開き、確認の中のボタンで実行する
  const [confirming, setConfirming] = useState(false);
  const [moveTo, setMoveTo] = useState(() => defaultAccountMoveTarget(accounts, account.name));
  const ref = useFocusOnOpen();
  const idBase = useRef(`acc-edit-${Math.random().toString(36).slice(2, 8)}`).current;
  const targets = accountMoveTargets(accounts, account.name);
  const blocked = needsOtherAccount(accounts, account.name);

  async function save(e: Event) {
    e.preventDefault();
    const check = checkAccountRename(accounts, account.name, newName);
    if (!check.ok) return setError(check.error);
    setError(null);
    setError(await props.onSave(check.value));
  }

  async function remove() {
    if (account.usage > 0 && moveTo === "") return setError("移し先の支払方法を選んでください");
    setError(null);
    setError(await props.onDelete(account.usage > 0 ? moveTo : undefined));
  }

  return (
    <form class="cat__form cat__edit" onSubmit={save} aria-label={`支払方法「${account.name}」の編集`}>
      <label for={`${idBase}-name`}>名前</label>
      <input id={`${idBase}-name`} ref={ref} type="text" value={newName} onInput={(e) => setNewName((e.currentTarget as HTMLInputElement).value)} autocomplete="off" />
      <FormError message={error} />
      <FormButtons busy={busy} submitLabel="保存" onCancel={props.onCancel} />

      <div class="cat__delete">
        {blocked ? (
          <p class="muted cat__hint">この支払方法を使っている支出があります。削除するには、先に別の支払方法を追加してください。</p>
        ) : confirming ? (
          <div class="cat__confirm" role="group" aria-label={`支払方法「${account.name}」の削除の確認`}>
            {account.usage > 0 ? (
              <>
                <p>
                  「{account.name}」を使っている{usageLabel(account.usage)}の支出を、別の支払方法に移してから削除します。
                </p>
                <label for={`${idBase}-move`}>移し先の支払方法</label>
                <select id={`${idBase}-move`} value={moveTo} onChange={(e) => setMoveTo((e.currentTarget as HTMLSelectElement).value)}>
                  {targets.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p>「{account.name}」を削除します。この操作は取り消せません。</p>
            )}
            <div class="cat__actions">
              <button type="button" class="btn cat__danger" disabled={busy} onClick={() => void remove()}>
                {account.usage > 0 ? "移して削除する" : "削除する"}
              </button>
              <button type="button" class="btn" disabled={busy} onClick={() => setConfirming(false)}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="button" class="btn cat__danger" disabled={busy} onClick={() => setConfirming(true)}>
            削除…
          </button>
        )}
      </div>
    </form>
  );
}
