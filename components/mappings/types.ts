import type { MappingStatus, MappingType } from "@/lib/types/domain";

/** Serializable question shape crossing the server → client boundary. */
export interface QuestionLite {
  id: string;
  code: string;
  text: string;
  energySource: string | null;
  criterion: string | null;
  concept: string | null;
}

/** Serializable mapping shape crossing the server → client boundary. */
export interface MappingRowLite {
  id: string;
  mappingName: string;
  commonConcept: string | null;
  energySource: string | null;
  criterion: string | null;
  mappingType: MappingType;
  comparisonMethod: string | null;
  professorNotes: string | null;
  mappingStatus: MappingStatus;
  professorApproved: boolean;
  version: number;
  previousVersionId: string | null;
  supersededById: string | null;
  a1QuestionIds: string[];
  a2QuestionIds: string[];
  updatedAt: string;
}
