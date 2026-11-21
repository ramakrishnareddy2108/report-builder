// Patient details are never read into the app.
//
// Headers that hold a patient's name, phone number or address cannot be picked as a source column or used
// in a formula. (A doctor, a bill number, a UMR number and so on are fine.)

const PATIENT_COLUMN = /patient|mobile|phone|address|contact|guardian|relative|aadha+r/i;

export function isPatientColumn(header: string): boolean {
  return PATIENT_COLUMN.test(header);
}

export const patientColumnMessage = (column: string): string =>
  `The column “${column}” holds patient details. Patient names, phone numbers and addresses are never used or stored; choose another column.`;
