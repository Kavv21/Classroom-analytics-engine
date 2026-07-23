"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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

/**
 * One side of the split screen: a searchable, keyboard-navigable question
 * picker built on shadcn's Command. Command's own text filtering is turned
 * off (shouldFilter={false}) because the energy-source / criterion /
 * concept dropdowns already narrow the list; Command's input drives only
 * the free-text search, exactly as the previous <input type="search"> did.
 * Multi-select is preserved via a Checkbox in each row, and the "0 — No" /
 * "1 — Yes" nature of the data is untouched (this picker chooses
 * questions, not answers).
 */
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

  // "" is not a valid Radix Select item value, so the "all" option uses a
  // sentinel that maps back to an empty filter.
  const ALL = "__all__";

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="border-b bg-muted p-3">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">
          {visible.length} of {questions.length} questions · {selected.size} selected
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Select
            value={filters.energySource || ALL}
            onValueChange={(v) => onFilters({ ...filters, energySource: v === ALL ? "" : v })}
          >
            <SelectTrigger className="h-8 text-xs" aria-label={`${title} energy source filter`}>
              <SelectValue placeholder="All energy sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All energy sources</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.criterion || ALL}
            onValueChange={(v) => onFilters({ ...filters, criterion: v === ALL ? "" : v })}
          >
            <SelectTrigger className="h-8 text-xs" aria-label={`${title} criterion filter`}>
              <SelectValue placeholder="All criteria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All criteria</SelectItem>
              {criteria.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {concepts.length > 0 && (
            <Select
              value={filters.concept || ALL}
              onValueChange={(v) => onFilters({ ...filters, concept: v === ALL ? "" : v })}
            >
              <SelectTrigger className="h-8 text-xs" aria-label={`${title} concept filter`}>
                <SelectValue placeholder="All concepts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All concepts</SelectItem>
                {concepts.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <Command shouldFilter={false} className="rounded-none border-0">
        <CommandInput
          value={filters.search}
          onValueChange={(v) => onFilters({ ...filters, search: v })}
          placeholder="Search wording or code…"
        />
        <CommandList className="max-h-96">
          <CommandEmpty>No questions match these filters.</CommandEmpty>
          <CommandGroup>
            {visible.map((q) => (
              <CommandItem
                key={q.id}
                value={`${q.code} ${q.text}`}
                onSelect={() => onToggle(q.id)}
                className="items-start gap-2"
              >
                <Checkbox checked={selected.has(q.id)} className="mt-1" tabIndex={-1} />
                <span className="min-w-0">
                  <span className="font-mono text-xs text-muted-foreground">{q.code}</span>{" "}
                  <span>{q.text}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {[q.energySource, q.criterion, q.concept].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
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
      toast.error(
        result.fieldErrors
          ? `${result.error} ${Object.values(result.fieldErrors).flat().join(" ")}`
          : result.error
      );
      return;
    }
    toast.success(editingId ? "Mapping updated." : "Mapping created.");
    resetForm();
    router.refresh();
  }

  async function seedSuggestions() {
    setBusy(true);
    const result = await seedMappingSuggestions(classId);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Suggestions generated: ${result.data.created} new, ` +
        `${result.data.skippedExisting} already present. Nothing is approved automatically.`
    );
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Split screen: A1 left, A2 right — genuinely resizable so a
          professor can widen whichever side they are reading. Collapses to
          stacked panels below lg. */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="hidden min-h-[28rem] rounded-md border lg:flex"
      >
        <ResizablePanel defaultSize={50} minSize={25}>
          <QuestionColumn
            title={`Assignment 1 — ${a1Title}`}
            questions={a1Questions}
            filters={a1Filters}
            onFilters={setA1Filters}
            selected={a1Selected}
            onToggle={(id) => toggle(1, id)}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={25}>
          <QuestionColumn
            title={`Assignment 2 — ${a2Title}`}
            questions={a2Questions}
            filters={a2Filters}
            onFilters={setA2Filters}
            selected={a2Selected}
            onToggle={(id) => toggle(2, id)}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Stacked, non-resizable fallback on narrow screens. */}
      <div className="flex flex-col gap-4 lg:hidden">
        <div className="rounded-md border">
          <QuestionColumn
            title={`Assignment 1 — ${a1Title}`}
            questions={a1Questions}
            filters={a1Filters}
            onFilters={setA1Filters}
            selected={a1Selected}
            onToggle={(id) => toggle(1, id)}
          />
        </div>
        <div className="rounded-md border">
          <QuestionColumn
            title={`Assignment 2 — ${a2Title}`}
            questions={a2Questions}
            filters={a2Filters}
            onFilters={setA2Filters}
            selected={a2Selected}
            onToggle={(id) => toggle(2, id)}
          />
        </div>
      </div>

      {/* Mapping form */}
      <Card>
        <CardContent className="pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{editingId ? "Edit mapping" : "Create mapping from selection"}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={seedSuggestions}>
              Generate suggestions
            </Button>
            <Button asChild variant="outline">
              <a href={`/classes/${classId}/mappings/export?format=csv`}>Export CSV</a>
            </Button>
            <Button asChild variant="outline">
              <a href={`/classes/${classId}/mappings/export?format=json`}>Export JSON</a>
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mapping-name">Mapping name *</Label>
            <Input
              id="mapping-name"
              value={mappingName}
              onChange={(e) => setMappingName(e.target.value)}
              placeholder="e.g. Renewable — Solar"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mapping-type">Mapping type *</Label>
            <Select value={mappingType} onValueChange={(v) => setMappingType(v as MappingType)}>
              <SelectTrigger id="mapping-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAPPING_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {mappingTypeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="common-concept">Common concept</Label>
            <Input
              id="common-concept"
              value={commonConcept}
              onChange={(e) => setCommonConcept(e.target.value)}
              placeholder="e.g. renewable"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mapping-energy">Energy source</Label>
            <Input id="mapping-energy" value={energySource} onChange={(e) => setEnergySource(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mapping-criterion">Criterion</Label>
            <Input id="mapping-criterion" value={criterion} onChange={(e) => setCriterion(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mapping-method">Comparison method</Label>
            <Input
              id="mapping-method"
              value={comparisonMethod}
              onChange={(e) => setComparisonMethod(e.target.value)}
              placeholder="e.g. keyword_match:renewable"
            />
          </div>
          <div className="grid gap-1.5 md:col-span-2 lg:col-span-3">
            <Label htmlFor="mapping-notes">Notes</Label>
            <Textarea
              id="mapping-notes"
              value={professorNotes}
              onChange={(e) => setProfessorNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          Selected: {a1Selected.size} from Assignment 1, {a2Selected.size} from Assignment 2.
          {shapeHint && (
            <span className="ml-1 text-[color:var(--status-warning-text)]">{shapeHint}</span>
          )}
        </p>

        <div className="mt-3 flex gap-2">
          <Button
            disabled={busy || !!shapeHint || mappingName.trim() === ""}
            onClick={save}
          >
            {editingId ? "Save changes" : "Create mapping"}
          </Button>
          {(editingId || a1Selected.size > 0 || a2Selected.size > 0) && (
            <Button variant="outline" disabled={busy} onClick={resetForm}>
              {editingId ? "Cancel edit" : "Clear selection"}
            </Button>
          )}
        </div>
        </CardContent>
      </Card>

      <MappingTable
        mappings={mappings}
        questionsById={questionsById}
        onEdit={loadForEdit}
      />
    </div>
  );
}
