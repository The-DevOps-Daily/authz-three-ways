// Turn a Cerbos query plan into a SQL WHERE clause over `documents d`.
// Only the operators and attributes our policies produce are mapped. Anything
// else throws, so a policy change cannot silently widen a list.
import { PlanExpression, PlanExpressionValue, PlanExpressionVariable } from '@cerbos/core';

const COLUMNS = {
  'request.resource.attr.team': 'd.team_id',
};

// List attributes that live in another table: `value in attr` becomes EXISTS.
const MEMBERSHIP = {
  'request.resource.attr.viewers':
    "EXISTS (SELECT 1 FROM shares s WHERE s.document_id = d.id AND s.level = 'view' AND s.user_id = ?)",
  'request.resource.attr.editors':
    "EXISTS (SELECT 1 FROM shares s WHERE s.document_id = d.id AND s.level = 'edit' AND s.user_id = ?)",
};

function column(node) {
  if (!(node instanceof PlanExpressionVariable) || !(node.name in COLUMNS)) {
    throw new Error(`unmapped plan operand ${JSON.stringify(node)}`);
  }
  return COLUMNS[node.name];
}

function constant(node) {
  if (!(node instanceof PlanExpressionValue)) throw new Error(`expected a value: ${JSON.stringify(node)}`);
  return node.value;
}

export function planToSql(node, params) {
  if (!(node instanceof PlanExpression)) throw new Error(`unsupported plan node ${JSON.stringify(node)}`);
  const [a, b] = node.operands;
  switch (node.operator) {
    case 'and':
    case 'or':
      return `(${node.operands.map((o) => planToSql(o, params)).join(` ${node.operator.toUpperCase()} `)})`;
    case 'not':
      return `NOT ${planToSql(a, params)}`;
    case 'eq':
      params.push(constant(b));
      return `${column(a)} = ?`;
    case 'in': {
      if (b instanceof PlanExpressionVariable && b.name in MEMBERSHIP) {
        params.push(constant(a));
        return MEMBERSHIP[b.name];
      }
      const list = constant(b);
      if (list.length === 0) return '0';
      params.push(...list);
      return `${column(a)} IN (${list.map(() => '?').join(', ')})`;
    }
    default:
      throw new Error(`unsupported plan operator ${node.operator}`);
  }
}
