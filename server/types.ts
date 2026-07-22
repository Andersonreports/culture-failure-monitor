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

export const FAILURE_HEADERS = [
  'Timestamp',
  'OrderID',
  'SampleID',
  'PatientName',
  'HospitalName',
  'TestName',
  'BillDate',
  'Reason',
  'Notes',
  'ReportedBy',
  'BillImageLink',
  'ReferenceImageLinks',
  'FailureType',
  'RecollectionStatus',
  'MailSent',
] as const;

export interface FailureRow {
  Timestamp: string;
  OrderID: string;
  SampleID: string;
  PatientName: string;
  HospitalName: string;
  TestName: string;
  BillDate: string;
  Reason: string;
  Notes: string;
  ReportedBy: string;
  BillImageLink: string;
  ReferenceImageLinks: string;
  FailureType: string;
  RecollectionStatus: string;
  MailSent: string;
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
