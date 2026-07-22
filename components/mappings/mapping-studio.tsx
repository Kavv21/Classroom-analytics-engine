"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createMapping,
  seedMappingSuggestions,
  updateMapping,
} from "@/lib/mappings/actions";
import { MAPPING_TYPES, sideCountError } from "@/lib/mappings/schema";
import type { MappingType } from "@/lib/types/domain";
import type { MappingRowLite, QuestionLite } from "@/components/mappings/types";
import { MappingTable } from "@/components/mappings/mapping-table";
import { mappingTypeLabel } from "@/lib/ui/labels";

interface MappingStudioProps {
  classId: string;
  a1Title: string;
  a2Title: string;
  a1Questions: QuestionLite[];
  a2Questions: QuestionLite[];
  mappings: MappingRowLite[];
}


interface ColumnFilters {
  search: string;
  energySource: string;
  criterion: string;
  concept: string;
}

const EMPTY_FILTERS: ColumnFilters = { search: "", energySource: "", criterion: "", concept: "" };

function distinct(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.trim() !== ""))].sort();
}

function applyFilters(questions: QuestionLite[], f: ColumnFilters): QuestionLite[] {
  const needle = f.search.trim().toLowerCase();
  return questions.filter((q) => {
    if (f.energySource && q.energySource !== f.energySource) return false;
    if (f.criterion && q.criterion !== f.criterion) return false;
    if (f.concept && q.concept !== f.concept) return false;
    if (
      needle &&
      !q.text.toLowerCase().includes(needle) &&
      !q.code.toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });
}

function QuestionColumn({
  title,
  questions,
  filters,
  onFilters,
  selected,
  onToggle,
}: {
  title: string;
  questions: QuestionLite[];
  filters: ColumnFilters;
  onFilters: (f: ColumnFilters) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const sources = useMemo(() => distinct(questions.map((q) => q.energySource)), [questions]);
  const criteria = useMemo(() => distinct(questions.map((q) => q.criterion)), [questions]);
  const concepts = useMemo(() => distinct(questions.map((q) => q.concept)), [questions]);
  const visible = useMemo(() => applyFilters(questions, filters), [questions, filters]);

  const selectClass = "input input-compact";

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded border border-hairline">
      <div className="border-b border-hairline bg-surface-sunken p-3">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-ink-muted">
          {visible.length} of {questions.length} questions · {selected.size} selected
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onFilters({ ...filters, search: e.target.value })}
            placeholder="Search wording or code…"
            className="w-full input input-compact text-sm"
          />
          <select
            aria-label={`${title} energy source filter`}
            value={filters.energySource}
            onChange={(e) => onFilters({ ...filters, energySource: e.target.value })}
            className={selectClass}
          >
            <option value="">All energy sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            aria-label={`${title} criterion filter`}
            value={filters.criterion}
            onChange={(e) => onFilters({ ...filters, criterion: e.target.value })}
            className={selectClass}
          >
            <option value="">All criteria</option>
            {criteria.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {concepts.length > 0 && (
            <select
              aria-label={`${title} concept filter`}
              value={filters.concept}
              onChange={(e) => onFilters({ ...filters, concept: e.target.value })}
              className={selectClass}
            >
              <option value="">All concepts</option>
              {concepts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <ul className="max-h-96 divide-y divide-hairline overflow-y-auto">
        {visible.map((q) => (
          <li key={q.id}>
            <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-surface-info">
              <input
                type="checkbox"
                checked={selected.has(q.id)}
                onChange={() => onToggle(q.id)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="font-mono text-xs text-ink-muted">{q.code}</span>{" "}
                <span>{q.text}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {[q.energySource, q.criterion, q.concept].filter(Boolean).join(" · ")}
                </span>
              </span>
            </label>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-3 py-4 text-sm text-ink-muted">No questions match these filters.</li>
        )}
      </ul>
    </div>
  );
}

export function MappingStudio({
  classId,
  a1Title,
  a2Title,
  a1Questions,
  a2Questions,
  mappings,
}: MappingStudioProps) {
  const router = useRouter();

  const [a1Filters, setA1Filters] = useState<ColumnFilters>(EMPTY_FILTERS);
  const [a2Filters, setA2Filters] = useState<ColumnFilters>(EMPTY_FILTERS);
  const [a1Selected, setA1Selected] = useState<Set<string>>(new Set());
  const [a2Selected, setA2Selected] = useState<Set<string>>(new Set());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [mappingName, setMappingName] = useState("");
  const [mappingType, setMappingType] = useState<MappingType>("CONCEPTUAL_ONE_TO_ONE");
  const [commonConcept, setCommonConcept] = useState("");
  const [energySource, setEnergySource] = useState("");
  const [criterion, setCriterion] = useState("");
  const [comparisonMethod, setComparisonMethod] = useState("");
  const [professorNotes, setProfessorNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const questionsById = useMemo(() => {
    const map: Record<string, QuestionLite> = {};
    for (const q of [...a1Questions, ...a2Questions]) map[q.id] = q;
    return map;
  }, [a1Questions, a2Questions]);

  const shapeHint = sideCountError(mappingType, a1Selected.size, a2Selected.size);

  function toggle(side: 1 | 2, id: string) {
    const [selected, set] = side === 1 ? [a1Selected, setA1Selected] : [a2Selected, setA2Selected];
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set(next);
  }

  function resetForm() {
    setEditingId(null);
    setMappingName("");
    setMappingType("CONCEPTUAL_ONE_TO_ONE");
    setCommonConcept("");
    setEnergySource("");
    setCriterion("");
    setComparisonMethod("");
    setProfessorNotes("");
    setA1Selected(new Set());
    setA2Selected(new Set());
  }

  function loadForEdit(mapping: MappingRowLite) {
    setEditingId(mapping.id);
    setMappingName(mapping.mappingName);
    setMappingType(mapping.mappingType);
    setCommonConcept(mapping.commonConcept ?? "");
    setEnergySource(mapping.energySource ?? "");
    setCriterion(mapping.criterion ?? "");
    setComparisonMethod(mapping.comparisonMethod ?? "");
    setProfessorNotes(mapping.professorNotes ?? "");
    setA1Selected(new Set(mapping.a1QuestionIds));
    setA2Selected(new Set(mapping.a2QuestionIds));
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setError(null);
    setNotice(null);
    setBusy(true);
    const values = {
      mappingName,
      mappingType,
      a1QuestionIds: [...a1Selected],
      a2QuestionIds: [...a2Selected],
      commonConcept,
      energySource,
      criterion,
      comparisonMethod,
      professorNotes,
    };
    const result = editingId
      ? await updateMapping(editingId, values)
      : await createMapping(classId, values);
    setBusy(false);
    if (!result.success) {
      setError(
        result.fieldErrors
          ? `${result.error} ${Object.values(result.fieldErrors).flat().join(" ")}`
          : result.error
      );
      return;
    }
    setNotice(editingId ? "Mapping updated." : "Mapping created.");
    resetForm();
    router.refresh();
  }

  async function seedSuggestions() {
    setError(null);
    setNotice(null);
    setBusy(true);
    const result = await seedMappingSuggestions(classId);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setNotice(
      `Suggestions generated: ${result.data.created} new, ` +
        `${result.data.skippedExisting} already present. Nothing is approved automatically.`
    );
    router.refresh();
  }

  const inputClass = "w-full input input-compact.5 text-sm";

  return (
    <div className="mt-6 space-y-6">
      {/* Split screen: A1 left, A2 right */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <QuestionColumn
          title={`Assignment 1 — ${a1Title}`}
          questions={a1Questions}
          filters={a1Filters}
          onFilters={setA1Filters}
          selected={a1Selected}
          onToggle={(id) => toggle(1, id)}
        />
        <QuestionColumn
          title={`Assignment 2 — ${a2Title}`}
          questions={a2Questions}
          filters={a2Filters}
          onFilters={setA2Filters}
          selected={a2Selected}
          onToggle={(id) => toggle(2, id)}
        />
      </div>

      {/* Mapping form */}
      <div className="rounded border border-hairline p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium">{editingId ? "Edit mapping" : "Create mapping from selection"}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={seedSuggestions}
              className="btn btn-secondary disabled:opacity-60"
            >
              Generate suggestions
            </button>
            <a
              href={`/classes/${classId}/mappings/export?format=csv`}
              className="btn btn-secondary"
            >
              Export CSV
            </a>
            <a
              href={`/classes/${classId}/mappings/export?format=json`}
              className="btn btn-secondary"
            >
              Export JSON
            </a>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-ink-secondary">Mapping name *</span>
            <input
              value={mappingName}
              onChange={(e) => setMappingName(e.target.value)}
              className={inputClass}
              placeholder="e.g. Renewable — Solar"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-secondary">Mapping type *</span>
            <select
              value={mappingType}
              onChange={(e) => setMappingType(e.target.value as MappingType)}
              className={inputClass}
            >
              {MAPPING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {mappingTypeLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-secondary">Common concept</span>
            <input
              value={commonConcept}
              onChange={(e) => setCommonConcept(e.target.value)}
              className={inputClass}
              placeholder="e.g. renewable"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-secondary">Energy source</span>
            <input
              value={energySource}
              onChange={(e) => setEnergySource(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-secondary">Criterion</span>
            <input value={criterion} onChange={(e) => setCriterion(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-secondary">Comparison method</span>
            <input
              value={comparisonMethod}
              onChange={(e) => setComparisonMethod(e.target.value)}
              className={inputClass}
              placeholder="e.g. keyword_match:renewable"
            />
          </label>
          <label className="text-sm md:col-span-2 lg:col-span-3">
            <span className="mb-1 block text-ink-secondary">Notes</span>
            <textarea
              value={professorNotes}
              onChange={(e) => setProfessorNotes(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </label>
        </div>

        <p className="mt-2 text-sm text-ink-secondary">
          Selected: {a1Selected.size} from Assignment 1, {a2Selected.size} from Assignment 2.
          {shapeHint && <span className="ml-1 text-warn-text">{shapeHint}</span>}
        </p>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || !!shapeHint || mappingName.trim() === ""}
            onClick={save}
            className="btn btn-primary"
          >
            {editingId ? "Save changes" : "Create mapping"}
          </button>
          {(editingId || a1Selected.size > 0 || a2Selected.size > 0) && (
            <button
              type="button"
              disabled={busy}
              onClick={resetForm}
              className="rounded border border-strong px-4 py-2 text-sm font-medium hover:bg-surface-sunken disabled:opacity-60"
            >
              {editingId ? "Cancel edit" : "Clear selection"}
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm text-critical-text">
            {error}
          </p>
        )}
        {notice && <p className="mt-2 text-sm text-good-text">{notice}</p>}
      </div>

      <MappingTable
        mappings={mappings}
        questionsById={questionsById}
        onEdit={loadForEdit}
      />
    </div>
  );
}
