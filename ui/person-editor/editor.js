const utf8Bytes = value => new TextEncoder().encode(value).length;
"use strict";
(() => {
  // src/rp/schema.ts
  var RpError = class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  };
  function invalid(field2) {
    throw new RpError("invalid_record", "Invalid RP record: " + field2);
  }
  function denied(field2) {
    throw new RpError("scope_denied", "RP scope denied: " + field2);
  }
  function wellFormed(v) {
    return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
  }
  function object(v, required, optional = []) {
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) invalid("object");
    const r = v;
    const keys = Object.keys(r);
    for (const key2 of keys) {
      if (!required.includes(key2) && !optional.includes(key2)) {
        if (/^(?:approved|authority|owner|ownership|trusted|profile|profileId|scope|viewpoint|narrator|global|reasoning|accepted)$/u.test(key2)) denied("untrusted authority field");
        invalid("unknown field " + key2);
      }
      if (!("value" in Object.getOwnPropertyDescriptor(r, key2))) invalid("accessor");
    }
    for (const key2 of required) if (!Object.hasOwn(r, key2) || r[key2] === void 0) invalid("missing " + key2);
    return r;
  }
  function text(v, max = 4096, empty = false) {
    if (typeof v !== "string" || !empty && !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)) invalid("text");
    if (!wellFormed(v)) invalid("unpaired surrogate");
  }
  function id(v) {
    if (typeof v !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(v)) invalid("id");
  }
  function integer(v, min = 0) {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min) invalid("safe integer");
  }
  var MAX_RP_JSON_BYTES = 4194304;
  function cloneInput(input2, maxBytes = MAX_RP_JSON_BYTES, capacityError = false) {
    const visit = (v, depth) => {
      if (depth > 24) invalid("record depth");
      if (v === null || typeof v === "boolean") return;
      if (typeof v === "string") {
        if (v.length > 1048576 || !wellFormed(v)) invalid("record string");
        return;
      }
      if (typeof v === "number") {
        if (!Number.isFinite(v) || Number.isInteger(v) && !Number.isSafeInteger(v)) invalid("number");
        return;
      }
      if (!v || typeof v !== "object") invalid("JSON value");
      if (Array.isArray(v)) {
        if (v.length > 4096) invalid("array size");
        v.forEach((entry2) => visit(entry2, depth + 1));
        return;
      }
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) invalid("prototype");
      for (const key2 of Object.keys(v)) {
        const d = Object.getOwnPropertyDescriptor(v, key2);
        if (!("value" in d)) invalid("accessor");
        visit(d.value, depth + 1);
      }
    };
    visit(input2, 0);
    const encoded = JSON.stringify(input2);
    if (utf8Bytes(encoded, "utf8") > maxBytes) {
      if (capacityError) throw new RpError("capacity_exceeded", "RP complete envelope byte limit");
      invalid("record size");
    }
    return JSON.parse(encoded);
  }

  // src/rp/person/schema.ts
  var personKeys = { identity: "identity", background: "background", voice: "voice", values: "rule", boundaries: "rule", trait: "rule", feeling: "rule", stage: "background" };
  function personField(input2) {
    const f = object(input2, ["fieldId", "kind", "value", "policy"], ["validity"]);
    id(f.fieldId);
    text(f.value, 2048, true);
    if (!Object.hasOwn(personKeys, f.kind) || !["stable", "growable", "situational"].includes(f.policy)) invalid("person field kind/policy");
    if (f.policy === "situational") {
      const v = object(f.validity, ["kind"], ["sceneId", "from", "through"]);
      if (v.kind === "scene") {
        object(v, ["kind", "sceneId"]);
        id(v.sceneId);
      } else if (v.kind === "sequence") {
        object(v, ["kind", "from", "through"]);
        integer(v.from);
        integer(v.through);
        if (v.through < v.from) invalid("person validity interval");
      } else invalid("person validity kind");
    } else if (f.validity !== void 0) invalid("only situational fields have validity");
  }
  function personDraft(input2, known) {
    const value = cloneInput(input2);
    if (utf8Bytes(JSON.stringify(value), "utf8") > 65536) invalid("person draft exceeds 64 KiB");
    const d = object(value, ["schemaVersion", "kind", "personId", "fields", "relationships", "goals"]);
    if (d.schemaVersion !== 1 || d.kind !== "person-draft") invalid("person draft version");
    const entity = (v) => {
      id(v);
      if (!known.has(v)) denied("unknown person entity");
    };
    entity(d.personId);
    if (!Array.isArray(d.fields) || !d.fields.length || d.fields.length > 128) invalid("person field count");
    d.fields.forEach(personField);
    if (new Set(d.fields.map((f) => f.fieldId)).size !== d.fields.length) invalid("duplicate person field");
    if (!Array.isArray(d.relationships) || d.relationships.length > 32 || !Array.isArray(d.goals) || d.goals.length > 16) invalid("person relationships/goals count");
    for (const rel of d.relationships) {
      object(rel, ["targetId", "relation", "value"]);
      entity(rel.targetId);
      text(rel.value, 2048, true);
      if (!["trust", "affection", "loyalty", "rivalry", "debt", "promise", "kinship", "alliance", "tension"].includes(rel.relation)) invalid("person relationship");
    }
    if (new Set(d.relationships.map((r) => r.targetId + ":" + r.relation)).size !== d.relationships.length) invalid("duplicate relationship");
    for (const g of d.goals) {
      object(g, ["goalId", "category", "objective", "nextAction"], ["targetEntityId"]);
      id(g.goalId);
      text(g.objective, 2048);
      text(g.nextAction, 2048, true);
      if (!["task", "promise"].includes(g.category)) invalid("person goal category");
      if (g.category === "promise") entity(g.targetEntityId);
      else if (g.targetEntityId !== void 0) invalid("task target");
    }
    if (new Set(d.goals.map((g) => g.goalId)).size !== d.goals.length) invalid("duplicate goal");
    if (1 + d.fields.length + d.relationships.length + d.goals.length > 256) invalid("person initialization event count");
    return d;
  }

  // src/rp/person/editor-ids.ts
  function createDraftIds(draft) {
    const used = /* @__PURE__ */ new Set([...draft.fields.map((f) => f.fieldId), ...draft.goals.map((g) => g.goalId)]);
    let counter = 0;
    return (prefix) => {
      let value;
      do {
        value = prefix + "_" + ++counter;
      } while (used.has(value));
      used.add(value);
      return value;
    };
  }

  // src/rp/person/editor.ts
  var $ = (id2) => document.getElementById(id2);
  var kinds = { identity: "身份", background: "背景", voice: "表达", values: "价值观", boundaries: "边界", trait: "性格倾向", feeling: "当前感受", stage: "人生阶段" };
  var policies = { stable: "保持稳定", growable: "可经确认成长", situational: "仅在情境内有效" };
  var relations = { trust: "信任", affection: "亲近", loyalty: "忠诚", rivalry: "竞争", debt: "亏欠", promise: "承诺关系", kinship: "亲属", alliance: "同盟", tension: "矛盾" };
  var key;
  function input(parent, title, value, multiline = false) {
    const label = document.createElement("label"), el = document.createElement(multiline ? "textarea" : "input");
    label.textContent = title;
    el.value = value;
    el.maxLength = 2048;
    label.append(el);
    parent.append(label);
    return el;
  }
  function select(parent, title, choices, value) {
    const label = document.createElement("label"), el = document.createElement("select");
    label.textContent = title;
    for (const [key2, text2] of Object.entries(choices)) {
      const option = document.createElement("option");
      option.value = key2;
      option.textContent = text2;
      el.append(option);
    }
    el.value = value;
    label.append(el);
    parent.append(label);
    return el;
  }
  function entry(container) {
    const el = document.createElement("div");
    el.className = "entry";
    const remove = document.createElement("button");
    remove.textContent = "移除这一项";
    remove.onclick = () => el.remove();
    el.append(remove);
    $(container).append(el);
    return el;
  }
  var readers = /* @__PURE__ */ new WeakMap();
  function field(value) {
    const row = entry("fields"), kind = select(row, "项目", kinds, value.kind), content = input(row, "内容", value.value, true), policy = select(row, "改变方式", policies, value.policy);
    const validity = document.createElement("div");
    row.append(validity);
    const mode = select(validity, "有效范围", { scene: "指定场景", sequence: "已接受记录序号区间" }, value.validity?.kind ?? "scene");
    const scene = input(validity, "场景 ID（原生 RP 默认 rp_scene）", value.validity?.kind === "scene" ? value.validity.sceneId : "rp_scene");
    const from = input(validity, "起始接受序号（含）", String(value.validity?.kind === "sequence" ? value.validity.from : 1)), through = input(validity, "结束接受序号（含）", String(value.validity?.kind === "sequence" ? value.validity.through : 10));
    const update = () => {
      validity.hidden = policy.value !== "situational";
      scene.parentElement.hidden = mode.value !== "scene";
      from.parentElement.hidden = through.parentElement.hidden = mode.value !== "sequence";
    };
    policy.onchange = mode.onchange = update;
    update();
    readers.set(row, () => ({ fieldId: value.fieldId, kind: kind.value, value: content.value, policy: policy.value, ...policy.value === "situational" ? { validity: mode.value === "scene" ? { kind: "scene", sceneId: scene.value.trim() } : { kind: "sequence", from: Number(from.value), through: Number(through.value) } } : {} }));
  }
  function relationship(value) {
    const row = entry("relationships"), target = input(row, "对方人物 ID", value.targetId), relation = select(row, "关系方向：我 → 对方", relations, value.relation), content = input(row, "起点", value.value);
    readers.set(row, () => ({ targetId: target.value.trim(), relation: relation.value, value: content.value }));
  }
  function goal(value) {
    const row = entry("goals"), category = select(row, "愿望类型", { task: "个人目标", promise: "对另一个人的承诺" }, value.category), objective = input(row, "想完成什么", value.objective), nextAction = input(row, "下一步", value.nextAction), target = input(row, "承诺对象 ID（个人目标可留空）", value.targetEntityId ?? "");
    readers.set(row, () => ({ goalId: value.goalId, category: category.value, objective: objective.value, nextAction: nextAction.value, ...category.value === "promise" ? { targetEntityId: target.value.trim() } : {} }));
  }
  function read() {
    const readRows = (id2) => [...$(id2).children].map((row) => readers.get(row)());
    const raw = { schemaVersion: 1, kind: "person-draft", personId: $("personId").value.trim(), fields: readRows("fields"), relationships: readRows("relationships"), goals: readRows("goals") };
    return personDraft(raw, /* @__PURE__ */ new Set([raw.personId, ...raw.relationships.map((r) => r.targetId), ...raw.goals.flatMap((g) => g.targetEntityId ? [g.targetEntityId] : [])]));
  }
  function generate() {
    const draft = read(), encoded = JSON.stringify(draft);
    $("output").value = "/rp person preview " + encoded;
    $("status").textContent = `草稿已检查：${draft.fields.length} 项定义，${draft.relationships.length} 条关系，${draft.goals.length} 个目标。宿主仍会核对实体与权限。`;
    return draft;
  }
  function run(work) {
    try {
      work();
    } catch (e) {
      $("status").textContent = "未生成：" + (e instanceof Error ? e.message : String(e));
      $("output").value = "";
    }
  }
  function load(draft) {
    key = createDraftIds(draft);
    $("fields").replaceChildren();
    $("relationships").replaceChildren();
    $("goals").replaceChildren();
    $("personId").value = draft.personId;
    draft.fields.forEach(field);
    draft.relationships.forEach(relationship);
    draft.goals.forEach(goal);
  }
  $("addField").onclick = () => field({ fieldId: key("field"), kind: "background", value: "", policy: "stable" });
  $("addRelationship").onclick = () => relationship({ targetId: "", relation: "trust", value: "" });
  $("addGoal").onclick = () => goal({ goalId: key("goal"), category: "task", objective: "", nextAction: "" });
  $("generate").onclick = () => run(generate);
  $("download").onclick = () => run(() => {
    const draft = generate(), url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" })), a = document.createElement("a");
    a.href = url;
    a.download = draft.personId + ".person.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  });
  $("copy").onclick = async () => {
    try {
      generate();
      await navigator.clipboard.writeText($("output").value);
      $("status").textContent = "导入命令已复制。请在 DSH 中预览后确认。";
    } catch {
      $("output").select();
      $("status").textContent = "请选择上方命令并手动复制。";
    }
  };
  $("importFile").onchange = async (e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 65536) throw Error("草稿超过 64 KiB");
      const raw = JSON.parse(await file.text()), known = /* @__PURE__ */ new Set([raw.personId, ...(raw.relationships ?? []).map((r) => r.targetId), ...(raw.goals ?? []).flatMap((g) => g.targetEntityId ? [g.targetEntityId] : [])]);
      load(personDraft(raw, known));
      generate();
    } catch (e2) {
      $("status").textContent = "导入失败：" + (e2 instanceof Error ? e2.message : String(e2));
    }
  };
  load({ schemaVersion: 1, kind: "person-draft", personId: "erin", fields: [{ fieldId: "name", kind: "identity", value: "林澈", policy: "stable" }, { fieldId: "background", kind: "background", value: "在钟楼旁长大，想找回故乡的线索。", policy: "stable" }, { fieldId: "voice", kind: "voice", value: "温和、直接，遇到不确定的事会坦诚承认。", policy: "stable" }, { fieldId: "values", kind: "values", value: "珍惜共同经历，认真对待承诺。", policy: "growable" }, { fieldId: "boundaries", kind: "boundaries", value: "尊重彼此的选择。", policy: "stable" }], relationships: [], goals: [] });
})();
