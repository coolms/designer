/**
 * DMN decision-table editor -- the first concrete surface renderer
 * in the package. Not re-exported from the package root: the public
 * surface is `createEditor({surface: 'dmn-table'})`. Consumers that
 * develop against the sources import from here directly.
 */

export { DmnTableEditor } from './DmnTableEditor.js';
export type { DmnTableEditorOptions } from './DmnTableEditor.js';
export { DmnTableModel } from './DmnTableModel.js';
export { DmnTableView } from './DmnTableView.js';
export { emptyDecisionTable } from './types.js';
export type {
    Aggregator,
    DataType,
    DecisionTableModel,
    HitPolicy,
    InputClause,
    OutputClause,
    Rule,
} from './types.js';

export * from './commands.js';
export { writeDmnXml, readDmnXml, DmnXmlParseError } from './xml.js';
export type { DmnXmlParseErrorCode } from './xml.js';
