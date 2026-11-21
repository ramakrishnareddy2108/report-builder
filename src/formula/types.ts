// Shared types for the formula language.

/** A value a formula works with. null = blank. */
export type Value = number | string | boolean | Date | null;

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

export type Node =
  | { type: 'num'; value: number; pos: number }
  | { type: 'str'; value: string; pos: number }
  | { type: 'bool'; value: boolean; pos: number }
  | { type: 'ref'; name: string; pos: number }
  | { type: 'unary'; op: '-' | '+'; arg: Node; pos: number }
  | { type: 'percent'; arg: Node; pos: number }
  | { type: 'binary'; op: BinaryOp; left: Node; right: Node; pos: number }
  | { type: 'call'; name: string; args: Node[]; pos: number };

/** Where a column's value comes from while a formula runs. */
export interface FormulaContext {
  /** The value of `[name]`, or undefined when no such column exists. */
  getColumn(name: string): Value | undefined;
  /** The value of a recipe parameter for PARAM("name"), or undefined when there is no such parameter. */
  getParam?(name: string): Value | undefined;
}

/** Recipe parameters by name, for example { Month: "Oct-2026" }. */
export type FormulaParams = Readonly<Record<string, Value>>;

export type FormulaErrorCode = '#DIV/0!' | '#VALUE!' | '#NAME?' | '#REF!' | '#N/A' | '#NUM!';

/** A problem while a formula runs. IFERROR catches it. */
export class FormulaError extends Error {
  override name = 'FormulaError';
  constructor(
    readonly code: FormulaErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** A problem in the formula text. `position` is a 0-based character offset. */
export class FormulaSyntaxError extends Error {
  override name = 'FormulaSyntaxError';
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}
