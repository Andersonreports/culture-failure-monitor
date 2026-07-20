export type FailureCategory = 'before' | 'after';

export type RecollectionStatus = 'Pending' | 'Resolved';

export const FAILURE_TYPES: Record<FailureCategory, readonly string[]> = {
  before: [
    'Onco blocks - low tumor %',
    'Blood Sample - Lysed/Hemolysed/Clotted',
    'Wrong sample tubes',
    'Other',
  ],
  after: [
    'Karyotyping - Metaphase not yielded/contaminated',
    'NIPS - QC matrix failed',
    'Onco - low DNA/RNA concentration',
    'Onco-sequencing QC failure',
    'Microarray - No fetal genotype After MCC',
    'Covid - IC failed',
    'Fish her2 - Non diagnostics sample',
    'Other',
  ],
};

// Canonical field set + the order used only when creating a brand-new sheet.
// Existing sheets are read/written by matching these NAMES against the sheet's
// actual header row (see googleSheets.ts), so the app tolerates columns being
// manually reordered or new ones inserted - positions are never hardcoded.
export const FAILURE_HEADERS = [
  'Timestamp',
  'OrderID',
  'SampleID',
  'PatientName',
  'HospitalName',
  'TestName',
  'Reason',
  'Notes',
  'ReportedBy',
  'BillImageLink',
  'ReferenceImageLinks',
  'FailureType',
  'RecollectionStatus',
] as const;

export interface FailureRow {
  Timestamp: string;
  OrderID: string;
  SampleID: string;
  PatientName: string;
  HospitalName: string;
  TestName: string;
  Reason: string;
  Notes: string;
  ReportedBy: string;
  BillImageLink: string;
  ReferenceImageLinks: string;
  FailureType: string;
  RecollectionStatus: string;
  /** Not a persisted column - the sheet row number (1-based), attached at read time so updates can target this exact row. */
  rowNumber: number;
}

export interface AppConfig {
  port: string;
  google: {
    credentialsPath: string;
    tokenPath: string;
    sheetConfigPath: string;
    scopes: string[];
  };
  whatsapp: {
    coordinatorNumber: string;
  };
}
