// The formula reference shown on the Help page. A test checks that every function of the formula engine is listed here
// and that every example gives exactly the result printed next to it, so this page can never drift from the engine.

import type { Value } from '@/formula';

/** The sample row the examples use. Shown on the Help page above the reference. */
export const SAMPLE_ROW: Readonly<Record<string, Value>> = {
  Amount: 1200,
  Cost: 300,
  Discount: 150,
  Doctor: 'Dr A Kumar',
  Source: 'OP Billing',
  BILLNO: 'B101',
  BILLTYPE: 'Corporate.',
  'IP Revenue': 5000,
  'Total Revenue': 8000,
  'Gross Profit': 2000,
  Date: '2026-10-02',
  Notes: '',
};

export const SAMPLE_PARAMS: Readonly<Record<string, Value>> = { Month: 'Oct-2026' };

/** How a result is written on the page. */
export function showValue(v: Value): string {
  if (v === null) return '(blank)';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return `"${v}"`;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export type FormulaDoc = { name: string; syntax: string; text: string; example: string; result: string };
export type FormulaGroup = { title: string; docs: FormulaDoc[] };

const d = (name: string, syntax: string, text: string, example: string, result: string): FormulaDoc => ({ name, syntax, text, example, result });

export const FORMULA_GROUPS: FormulaGroup[] = [
  {
    title: 'Choosing (logic)',
    docs: [
      d('IF', 'IF(test, if true, if false)', 'Gives one value when the test is true and another when it is not.', 'IF([Amount] > 1000, "Large", "Small")', '"Large"'),
      d('IFS', 'IFS(test1, value1, test2, value2, …)', 'Checks tests in order and gives the value of the first one that is true.', 'IFS([Amount] > 5000, "High", [Amount] > 1000, "Medium")', '"Medium"'),
      d('IFERROR', 'IFERROR(value, if error)', 'Gives the value, or a replacement when it is an error such as dividing by zero.', 'IFERROR([Gross Profit] / 0, 0)', '0'),
      d('AND', 'AND(test1, test2, …)', 'True when every test is true.', 'AND([Amount] > 1000, [Cost] < 500)', 'TRUE'),
      d('OR', 'OR(test1, test2, …)', 'True when at least one test is true.', 'OR([Source] = "OP Pharmacy", [Source] = "OP Returns")', 'FALSE'),
      d('NOT', 'NOT(test)', 'Turns true into false and false into true.', 'NOT(ISBLANK([BILLNO]))', 'TRUE'),
    ],
  },
  {
    title: 'Numbers (maths)',
    docs: [
      d('ROUND', 'ROUND(number, digits)', 'Rounds to a number of decimals (halves round away from zero).', 'ROUND(1234.5678, 2)', '1234.57'),
      d('ROUNDUP', 'ROUNDUP(number, digits)', 'Rounds away from zero.', 'ROUNDUP(1234.561, 1)', '1234.6'),
      d('ROUNDDOWN', 'ROUNDDOWN(number, digits)', 'Rounds towards zero.', 'ROUNDDOWN(1234.569, 1)', '1234.5'),
      d('INT', 'INT(number)', 'The whole part, rounded down.', 'INT(7.9)', '7'),
      d('ABS', 'ABS(number)', 'The number without its minus sign.', 'ABS(-250)', '250'),
      d('MIN', 'MIN(a, b, …)', 'The smallest of the numbers.', 'MIN([Amount], [Cost])', '300'),
      d('MAX', 'MAX(a, b, …)', 'The largest of the numbers.', 'MAX([Amount], [Cost])', '1200'),
      d('SUM', 'SUM(a, b, …)', 'Adds the numbers.', 'SUM([Amount], [Cost], [Discount])', '1650'),
      d('AVERAGE', 'AVERAGE(a, b, …)', 'The average of the numbers.', 'AVERAGE([Amount], [Cost])', '750'),
      d('MOD', 'MOD(number, divisor)', 'The remainder after dividing.', 'MOD(10, 3)', '1'),
    ],
  },
  {
    title: 'Text',
    docs: [
      d('UPPER', 'UPPER(text)', 'Capital letters.', 'UPPER([Doctor])', '"DR A KUMAR"'),
      d('LOWER', 'LOWER(text)', 'Small letters.', 'LOWER([Doctor])', '"dr a kumar"'),
      d('PROPER', 'PROPER(text)', 'Capital first letter of each word.', 'PROPER("dr a KUMAR")', '"Dr A Kumar"'),
      d('TRIM', 'TRIM(text)', 'Removes extra spaces.', 'TRIM("  Dr   A  ")', '"Dr A"'),
      d('LEFT', 'LEFT(text, count)', 'The first letters.', 'LEFT([Doctor], 2)', '"Dr"'),
      d('RIGHT', 'RIGHT(text, count)', 'The last letters.', 'RIGHT([BILLNO], 3)', '"101"'),
      d('MID', 'MID(text, start, count)', 'Letters from the middle (the first letter is 1).', 'MID([BILLNO], 2, 3)', '"101"'),
      d('LEN', 'LEN(text)', 'How many letters.', 'LEN([BILLNO])', '4'),
      d('CONCAT', 'CONCAT(a, b, …)', 'Joins texts together. The & sign does the same.', 'CONCAT([Doctor], " - ", [Source])', '"Dr A Kumar - OP Billing"'),
      d('SUBSTITUTE', 'SUBSTITUTE(text, old, new)', 'Replaces part of a text.', 'SUBSTITUTE([BILLTYPE], ".", "")', '"Corporate"'),
      d('SEARCH', 'SEARCH(find, in text)', 'The position of a word in a text (capitals are ignored). It is an error when it is not there.', 'SEARCH("kumar", [Doctor])', '6'),
      d('CONTAINS', 'CONTAINS(text, part)', 'True when the text has the part in it (capitals are ignored).', 'CONTAINS([Doctor], "kumar")', 'TRUE'),
      d('STARTSWITH', 'STARTSWITH(text, start)', 'True when the text begins with the start (capitals are ignored).', 'STARTSWITH([Doctor], "dr")', 'TRUE'),
    ],
  },
  {
    title: 'Checking values',
    docs: [
      d('ISBLANK', 'ISBLANK(value)', 'True when there is nothing in the cell (or only spaces).', 'ISBLANK([Notes])', 'TRUE'),
      d('ISNUMBER', 'ISNUMBER(value)', 'True when the value is a number.', 'ISNUMBER([Amount])', 'TRUE'),
      d('VALUE', 'VALUE(text)', 'Turns text such as "1,234.50" into a number.', 'VALUE("1,234.50")', '1234.5'),
    ],
  },
  {
    title: 'Dates',
    docs: [
      d('YEAR', 'YEAR(date)', 'The year of a date.', 'YEAR([Date])', '2026'),
      d('MONTH', 'MONTH(date)', 'The month number of a date.', 'MONTH([Date])', '10'),
      d('DAY', 'DAY(date)', 'The day of a date.', 'DAY([Date])', '2'),
      d('TEXT', 'TEXT(date, "format")', 'Writes a date as text. Formats: YYYY-MM, MMM-YYYY, DD-MM-YYYY (also YY, MM, MMMM, DD).', 'TEXT([Date], "MMM-YYYY")', '"Oct-2026"'),
    ],
  },
  {
    title: 'Recipe values',
    docs: [d('PARAM', 'PARAM("name")', 'The value you typed for a recipe question, such as the report month.', 'PARAM("Month")', '"Oct-2026"')],
  },
];

export type EverydayFormula = { title: string; text: string; formula: string; result: string };

/** Everyday jobs, as complete formulas. */
export const EVERYDAY: EverydayFormula[] = [
  { title: 'Leave out the totals row at the bottom of an export', text: 'In Sources, under “Keep a row when”. A totals row has no bill number.', formula: 'NOT(ISBLANK([BILLNO]))', result: 'TRUE' },
  { title: 'Keep rows that meet several conditions', text: 'Put them inside AND(…). Use OR(…) when any one is enough.', formula: 'AND(NOT(ISBLANK([BILLNO])), [BILLTYPE] <> "Corporate.", [Amount] > 0)', result: 'FALSE' },
  { title: 'Add up only some sources', text: 'In Report, on a total column, under “Only count rows from”. Or write it as a condition.', formula: 'OR([Source] = "OP Billing", [Source] = "OP Returns")', result: 'TRUE' },
  { title: 'Work out a new amount', text: 'In Sources, under “Calculated columns”. Column names go in square brackets.', formula: '[Amount] - [Discount]', result: '1050' },
  { title: 'Get the month from a date', text: 'Useful for grouping by month, or for checking a file is for the right month.', formula: 'TEXT([Date], "MMM-YYYY")', result: '"Oct-2026"' },
  { title: 'Check a date against the month you typed', text: 'PARAM reads what you typed on the Generate page.', formula: 'TEXT([Date], "MMM-YYYY") = PARAM("Month")', result: 'TRUE' },
  { title: 'Divide safely', text: 'Without IFERROR a division by zero leaves the cell blank and a warning is shown.', formula: 'IFERROR([Gross Profit] / [Total Revenue] * 100, 0)', result: '25' },
  { title: 'Gross profit in a report column', text: 'A formula column can use any other column of the same report.', formula: '[Total Revenue] - [Cost] - [Discount]', result: '7550' },
];
