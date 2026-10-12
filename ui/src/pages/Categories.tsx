import { useEffect, useRef, useState } from "preact/hooks";
import type { ApiResult, CategoryIconKey, CategoryView } from "../../../src/api/contract";
import { CategoryIcon } from "../components/CategoryIcon";
import { CategoryIconPicker } from "../components/CategoryIconPicker";
import { addCategory, deleteCategory, getCategories, renameCategoryGroup, updateCategory } from "../api";
import {
  MAX_GROUP_NAME,
  buildCategoryPatch,
  canDeleteAny,
  checkGroupRename,
  checkNewCategory,
  defaultMoveTarget,
  errorText,
  groupCategories,
  moveTargets,
  usageLabel,
  validateName,
  type GroupView,
} from "./categoriesLogic";
import { AccountsSection } from "./AccountsSection";
import "./Categories.css";

// いま開いているフォーム(同時に1つだけ)
type Mode =
  | { kind: "none" }
  | { kind: "rename-group"; group: string }
  | { kind: "edit"; name: string }
  | { kind: "add"; group: string }
  | { kind: "add-group" };

// フォームの送信。失敗したときだけ理由(日本語)を返し、成功は null
type Submit<T> = (value: T) => Promise<string | null>;

// 開いたフォームの最初の入力欄にフォーカスを移す
function useFocusOnOpen() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

export function Categories() {
  const [cats, setCats] = useState<CategoryView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function load() {
    try {
      const res = await getCategories();
      if (res.ok) {
        setCats(res.categories);
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

  const groups = cats ? groupCategories(cats) : [];

  return (
    <section class="page cat">
      <header class="cat__header">
        <h1 class="cat__title">カテゴリ・支払方法</h1>
        <p class="cat__lead">大分類の下に、サブカテゴリを並べます。支出に付けるのはサブカテゴリです。AI(Claude など)からも同じように増やせます。</p>
      </header>

      {notice && (
        <p class="cat__notice" role="status">
          {notice}
        </p>
      )}

      {cats === null && loadError === null && (
        <p class="muted cat__status" role="status">
          読み込み中です…
        </p>
      )}
      {loadError !== null && (
        <div class="card cat__status" role="alert">
          <p class="error">{loadError}</p>
          <button type="button" class="btn" onClick={() => void load()}>
            もう一度読み込む
          </button>
        </div>
      )}

      {cats !== null && (
        <>
          <div class="cat__grid">
            {groups.map((g, i) => (
              <GroupCard
                key={g.group_name}
                index={i}
                group={g}
                groups={groups}
                cats={cats}
                mode={mode}
                busy={busy}
                open={open}
                close={close}
                onRename={(newName) => act(() => renameCategoryGroup({ group: g.group_name, new_name: newName }))}
                onAdd={(name, icon) => act(() => addCategory({ name, group_name: g.group_name, ...(icon ? { icon } : {}) }))}
                onUpdate={(name, patch) => act(() => updateCategory(name, patch))}
                onDelete={(name, moveTo) => act(() => deleteCategory(name, moveTo))}
              />
            ))}
          </div>

          {mode.kind === "add-group" ? (
            <AddGroupForm groups={groups} cats={cats} busy={busy} onSubmit={(group, name, icon) => act(() => addCategory({ name, group_name: group, ...(icon ? { icon } : {}) }))} onCancel={close} />
          ) : (
            <button type="button" class="btn cat__add-group" onClick={() => open({ kind: "add-group" })}>
              大分類を追加
            </button>
          )}
        </>
      )}

      <AccountsSection />
    </section>
  );
}

interface GroupCardProps {
  index: number;
  group: GroupView;
  groups: GroupView[];
  cats: CategoryView[];
  mode: Mode;
  busy: boolean;
  open: (m: Mode) => void;
  close: () => void;
  onRename: Submit<string>;
  onAdd: (name: string, icon: CategoryIconKey | null) => Promise<string | null>;
  onUpdate: (name: string, patch: { new_name?: string; group_name?: string; icon?: CategoryIconKey | null }) => Promise<string | null>;
  onDelete: (name: string, moveTo?: string) => Promise<string | null>;
}

function GroupCard(props: GroupCardProps) {
  const { group, groups, cats, mode, busy, index } = props;
  const headingId = `cat-group-${index}`;
  const renaming = mode.kind === "rename-group" && mode.group === group.group_name;
  const adding = mode.kind === "add" && mode.group === group.group_name;

  return (
    <section class="cat__card" aria-labelledby={headingId}>
      {renaming ? (
        <RenameGroupForm group={group.group_name} groups={groups} busy={busy} onSubmit={props.onRename} onCancel={props.close} />
      ) : (
        <header class="cat__card-head">
          <h2 id={headingId} class="cat__group">
            {group.group_name}
          </h2>
          <button type="button" class="cat__link" aria-label={`大分類「${group.group_name}」の名前を変更`} onClick={() => props.open({ kind: "rename-group", group: group.group_name })}>
            名前を変更
          </button>
        </header>
      )}

      <ul class="cat__list">
        {group.categories.map((c) => {
          const editing = mode.kind === "edit" && mode.name === c.name;
          return (
            <li key={c.name} class={`cat__row${editing ? " is-editing" : ""}`}>
              {editing ? (
                <EditForm
                  name={c.name}
                  usage={c.usage}
                  group={group.group_name}
                  icon={c.icon}
                  groups={groups}
                  cats={cats}
                  busy={busy}
                  onSave={props.onUpdate}
                  onDelete={props.onDelete}
                  onCancel={props.close}
                />
              ) : (
                <>
                  <span class="cat__icon">
                    <CategoryIcon icon={c.icon} />
                  </span>
                  <span class="cat__name">{c.name}</span>
                  <span class={`cat__usage num${c.usage === 0 ? " is-zero" : ""}`}>{usageLabel(c.usage)}</span>
                  <button type="button" class="cat__link" aria-label={`「${c.name}」を編集`} onClick={() => props.open({ kind: "edit", name: c.name })}>
                    編集
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <AddCategoryForm cats={cats} group={group.group_name} busy={busy} onSubmit={props.onAdd} onCancel={props.close} />
      ) : (
        <button type="button" class="cat__add" aria-label={`大分類「${group.group_name}」にサブカテゴリを追加`} onClick={() => props.open({ kind: "add", group: group.group_name })}>
          <span aria-hidden="true">＋</span> サブカテゴリを追加
        </button>
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

function AddCategoryForm(props: { cats: CategoryView[]; group: string; busy: boolean; onSubmit: (name: string, icon: CategoryIconKey | null) => Promise<string | null>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<CategoryIconKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useFocusOnOpen();
  const id = useRef(`cat-add-${Math.random().toString(36).slice(2, 8)}`).current;

  async function submit(e: Event) {
    e.preventDefault();
    const check = checkNewCategory(props.cats, name);
    if (!check.ok) return setError(check.error);
    setError(null);
    setError(await props.onSubmit(check.value, icon));
  }

  return (
    <form class="cat__form" onSubmit={submit}>
      <label for={id}>サブカテゴリの名前({props.group})</label>
      <input id={id} ref={ref} type="text" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} autocomplete="off" />
      <CategoryIconPicker value={icon} onChange={setIcon} disabled={props.busy} />
      <FormError message={error} />
      <FormButtons busy={props.busy} submitLabel="追加" onCancel={props.onCancel} />
    </form>
  );
}

function AddGroupForm(props: { groups: GroupView[]; cats: CategoryView[]; busy: boolean; onSubmit: (group: string, name: string, icon: CategoryIconKey | null) => Promise<string | null>; onCancel: () => void }) {
  const [group, setGroup] = useState("");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<CategoryIconKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useFocusOnOpen();
  const existing = props.groups.some((g) => g.group_name === group.trim());

  async function submit(e: Event) {
    e.preventDefault();
    const g = validateName(group, "大分類名", MAX_GROUP_NAME);
    if (!g.ok) return setError(g.error);
    const n = checkNewCategory(props.cats, name);
    if (!n.ok) return setError(n.error);
    setError(null);
    setError(await props.onSubmit(g.value, n.value, icon));
  }

  return (
    <form class="cat__card cat__form" onSubmit={submit} aria-label="大分類を追加">
      <h2 class="cat__group">大分類を追加</h2>
      <label for="cat-new-group">大分類の名前</label>
      <input id="cat-new-group" ref={ref} type="text" value={group} onInput={(e) => setGroup((e.currentTarget as HTMLInputElement).value)} autocomplete="off" />
      {existing && <p class="muted cat__hint">「{group.trim()}」は既にある大分類です。その下にサブカテゴリを追加します。</p>}
      <label for="cat-new-first">最初のサブカテゴリの名前</label>
      <input id="cat-new-first" type="text" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} autocomplete="off" />
      <CategoryIconPicker value={icon} onChange={setIcon} disabled={props.busy} />
      <p class="muted cat__hint">大分類は、サブカテゴリが1つ以上あるときだけ表示されます。</p>
      <FormError message={error} />
      <FormButtons busy={props.busy} submitLabel="追加" onCancel={props.onCancel} />
    </form>
  );
}

function RenameGroupForm(props: { group: string; groups: GroupView[]; busy: boolean; onSubmit: Submit<string>; onCancel: () => void }) {
  const [name, setName] = useState(props.group);
  const [error, setError] = useState<string | null>(null);
  const ref = useFocusOnOpen();
  const preview = checkGroupRename(props.groups, props.group, name);

  async function submit(e: Event) {
    e.preventDefault();
    const check = checkGroupRename(props.groups, props.group, name);
    if (!check.ok) return setError(check.error);
    setError(null);
    setError(await props.onSubmit(check.value));
  }

  return (
    <form class="cat__form" onSubmit={submit}>
      <label for="cat-rename-group">大分類「{props.group}」の新しい名前</label>
      <input id="cat-rename-group" ref={ref} type="text" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} autocomplete="off" />
      {preview.ok && preview.merge && <p class="cat__hint cat__hint--warn">同じ名前の大分類があるため、そちらに統合されます。</p>}
      <FormError message={error} />
      <FormButtons busy={props.busy} submitLabel="保存" onCancel={props.onCancel} />
    </form>
  );
}

interface EditFormProps {
  name: string;
  usage: number;
  group: string;
  icon: CategoryIconKey | null;
  groups: GroupView[];
  cats: CategoryView[];
  busy: boolean;
  onSave: (name: string, patch: { new_name?: string; group_name?: string; icon?: CategoryIconKey | null }) => Promise<string | null>;
  onDelete: (name: string, moveTo?: string) => Promise<string | null>;
  onCancel: () => void;
}

function EditForm(props: EditFormProps) {
  const { name, usage, groups, busy } = props;
  const [newName, setNewName] = useState(name);
  const [group, setGroup] = useState(props.group);
  const [icon, setIcon] = useState<CategoryIconKey | null>(props.icon);
  const [error, setError] = useState<string | null>(null);
  // 削除は2段階: 「削除…」で確認を開き、確認の中のボタンで実行する
  const [confirming, setConfirming] = useState(false);
  const [moveTo, setMoveTo] = useState(() => defaultMoveTarget(groups, name));
  const ref = useFocusOnOpen();
  const idBase = useRef(`cat-edit-${Math.random().toString(36).slice(2, 8)}`).current;
  const targets = moveTargets(groups, name);
  const deletable = canDeleteAny(props.cats);

  async function save(e: Event) {
    e.preventDefault();
    const check = buildCategoryPatch(props.cats, { name, group_name: props.group, icon: props.icon }, { name: newName, group, icon });
    if (!check.ok) return setError(check.error);
    setError(null);
    setError(await props.onSave(name, check.patch));
  }

  async function remove() {
    if (usage > 0 && moveTo === "") return setError("移し先のカテゴリを選んでください");
    setError(null);
    setError(await props.onDelete(name, usage > 0 ? moveTo : undefined));
  }

  return (
    <form class="cat__form cat__edit" onSubmit={save} aria-label={`「${name}」の編集`}>
      <label for={`${idBase}-name`}>名前</label>
      <input id={`${idBase}-name`} ref={ref} type="text" value={newName} onInput={(e) => setNewName((e.currentTarget as HTMLInputElement).value)} autocomplete="off" />
      <label for={`${idBase}-group`}>大分類</label>
      <select id={`${idBase}-group`} value={group} onChange={(e) => setGroup((e.currentTarget as HTMLSelectElement).value)}>
        {groups.map((g) => (
          <option key={g.group_name} value={g.group_name}>
            {g.group_name}
          </option>
        ))}
      </select>
      <CategoryIconPicker value={icon} onChange={setIcon} disabled={busy} />
      <FormError message={error} />
      <FormButtons busy={busy} submitLabel="保存" onCancel={props.onCancel} />

      <div class="cat__delete">
        {!deletable ? (
          <p class="muted cat__hint">最後の1つのカテゴリは削除できません。</p>
        ) : confirming ? (
          <div class="cat__confirm" role="group" aria-label={`「${name}」の削除の確認`}>
            {usage > 0 ? (
              <>
                <p>
                  「{name}」を使っている{usageLabel(usage)}の支出を、別のカテゴリに移してから削除します。
                </p>
                <label for={`${idBase}-move`}>移し先のカテゴリ</label>
                <select id={`${idBase}-move`} value={moveTo} onChange={(e) => setMoveTo((e.currentTarget as HTMLSelectElement).value)}>
                  {targets.map((g) => (
                    <optgroup key={g.group_name} label={g.group_name}>
                      {g.categories.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </>
            ) : (
              <p>「{name}」を削除します。この操作は取り消せません。</p>
            )}
            <div class="cat__actions">
              <button type="button" class="btn cat__danger" disabled={busy} onClick={() => void remove()}>
                {usage > 0 ? "移して削除する" : "削除する"}
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
