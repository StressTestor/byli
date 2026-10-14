import {
  GraphQLError, Kind, getArgumentValues, getNamedType, getVariableValues,
  isCompositeType, isObjectType, isInterfaceType,
  type DocumentNode, type GraphQLCompositeType, type GraphQLSchema,
  type OperationDefinitionNode, type SelectionSetNode, type ValidationRule,
} from 'graphql';

export const MAX_QUERY_TOKENS = 3_000;
export const MAX_ROOT_FIELDS = 8;
export const MAX_ALIASES = 30;
export const MAX_EXPANDED_FIELDS = 250;
export const MAX_CATEGORY_RESULTS = 50;
export const MAX_SUBMISSION_RESULTS = 50;
export const MAX_RESULT_COST = 10_000;
export const MAX_DATA_WORK = 1_000;

const introspection = new Set(['__schema', '__type']);
const limitError = (message: string) => new GraphQLError(message, {
  extensions: { code: 'GRAPHQL_VALIDATION_FAILED', http: { status: 400 } },
});

// Bound breadth before execution. Fragment summaries are memoized and sums
// saturate, so a tiny document cannot make this validator expand exponentially.
export const documentLimits: ValidationRule = (context) => ({
  Document(document) {
    const operations = document.definitions.filter(def => def.kind === Kind.OPERATION_DEFINITION);
    if (operations.length !== 1) {
      context.reportError(limitError('Send exactly one GraphQL operation per request.'));
      return;
    }
    type Size = { fields: number; aliases: number; roots: number };
    const memo = new Map<string, Size>();
    const active = new Set<string>();
    const add = (a: Size, b: Size): Size => ({
      fields: Math.min(MAX_EXPANDED_FIELDS + 1, a.fields + b.fields),
      aliases: Math.min(MAX_ALIASES + 1, a.aliases + b.aliases),
      roots: Math.min(MAX_ROOT_FIELDS + 1, a.roots + b.roots),
    });
    function measure(set: SelectionSetNode): Size {
      let total: Size = { fields: 0, aliases: 0, roots: 0 };
      for (const selection of set.selections) {
        let size: Size = { fields: 0, aliases: 0, roots: 0 };
        if (selection.kind === Kind.FIELD) {
          const child = selection.selectionSet && !introspection.has(selection.name.value)
            ? measure(selection.selectionSet) : size;
          size = add(child, { fields: 1, aliases: selection.alias ? 1 : 0, roots: 0 });
          size.roots = 1;
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          size = measure(selection.selectionSet);
        } else {
          const name = selection.name.value;
          const fragment = context.getFragment(name);
          if (fragment && !active.has(name)) {
            if (!memo.has(name)) {
              active.add(name);
              memo.set(name, measure(fragment.selectionSet));
              active.delete(name);
            }
            size = memo.get(name)!;
          }
        }
        total = add(total, size);
      }
      return total;
    }
    const operation = operations[0];
    const size = measure(operation.selectionSet);
    const roots = operation.operation === 'mutation' ? 1 : MAX_ROOT_FIELDS;
    if (size.roots > roots) context.reportError(limitError(`GraphQL operations support at most ${roots} root fields.`));
    if (size.aliases > MAX_ALIASES) context.reportError(limitError(`GraphQL operations support at most ${MAX_ALIASES} aliases.`));
    if (size.fields > MAX_EXPANDED_FIELDS) context.reportError(limitError(`GraphQL operations support at most ${MAX_EXPANDED_FIELDS} expanded fields.`));
  },
});

// Run on every request, including Apollo's validated-document cache hits.
// Variables are coerced with GraphQL's own rules, including operation/argument
// defaults. Directives are conservatively charged even when a branch is skipped.
export function enforceOperationBudget(
  schema: GraphQLSchema,
  document: DocumentNode,
  operation: OperationDefinitionNode,
  rawVariables: Record<string, unknown> = {},
) {
  const variables = getVariableValues(schema, operation.variableDefinitions ?? [], rawVariables, { maxErrors: 10 });
  if (variables.errors) throw new GraphQLError(variables.errors[0].message, {
    nodes: variables.errors[0].nodes,
    extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } },
  });
  const fragments = new Map(document.definitions.flatMap(def =>
    def.kind === Kind.FRAGMENT_DEFINITION ? [[def.name.value, def] as const] : []));
  type Cost = { result: number; data: number };
  const memo = new Map<string, Cost>();
  const active = new Set<string>();
  const add = (a: Cost, b: Cost, multiplier = 1): Cost => ({
    result: Math.min(MAX_RESULT_COST + 1, a.result + multiplier * b.result),
    data: Math.min(MAX_DATA_WORK + 1, a.data + multiplier * b.data),
  });
  function measure(set: SelectionSetNode, parent: GraphQLCompositeType): Cost {
    let total: Cost = { result: 0, data: 0 };
    for (const selection of set.selections) {
      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value;
        const fragment = fragments.get(name);
        if (!fragment || active.has(name)) continue;
        const key = `${parent.name}:${name}`;
        if (!memo.has(key)) {
          active.add(name);
          const type = schema.getType(fragment.typeCondition.name.value);
          memo.set(key, measure(fragment.selectionSet, type && isCompositeType(type) ? type : parent));
          active.delete(name);
        }
        total = add(total, memo.get(key)!);
        continue;
      }
      if (selection.kind === Kind.INLINE_FRAGMENT) {
        const type = selection.typeCondition ? schema.getType(selection.typeCondition.name.value) : parent;
        total = add(total, measure(selection.selectionSet, type && isCompositeType(type) ? type : parent));
        continue;
      }
      if (introspection.has(selection.name.value)) continue;
      const field = isObjectType(parent) || isInterfaceType(parent) ? parent.getFields()[selection.name.value] : undefined;
      if (!field) continue; // __typename or a normal validation error
      const coordinate = `${parent.name}.${selection.name.value}`;
      let multiplier = 1;
      let data = 0;
      if (['Query.articles', 'Query.trending', 'Author.articles'].includes(coordinate)) {
        const args = getArgumentValues(field, selection, variables.coerced);
        const first = args.first ?? (coordinate === 'Author.articles' ? 10 : 20);
        if (typeof first !== 'number' || !Number.isInteger(first) || first < 1 || first > 50) {
          throw limitError('first must be an integer between 1 and 50.');
        }
        multiplier = first;
        data = first + 1; // includes the pagination sentinel, even with no edges selected
      } else if (['Query.categories', 'Article.categories'].includes(coordinate)) {
        multiplier = MAX_CATEGORY_RESULTS;
        data = coordinate === 'Query.categories' ? MAX_CATEGORY_RESULTS : 0;
      } else if (coordinate === 'Query.mySubmissions') {
        multiplier = MAX_SUBMISSION_RESULTS;
        data = MAX_SUBMISSION_RESULTS;
      } else if (parent.name === 'Query' || parent.name === 'Mutation'
        || coordinate === 'Category.articleCount' || coordinate.startsWith('Article.viewer')) {
        data = 1;
      }
      const type = getNamedType(field.type);
      const child = selection.selectionSet && isCompositeType(type)
        ? measure(selection.selectionSet, type) : { result: 0, data: 0 };
      total = add(total, add({ result: 1, data }, child, multiplier));
    }
    return total;
  }
  const root = operation.operation === 'mutation' ? schema.getMutationType() : schema.getQueryType();
  if (!root) return;
  const cost = measure(operation.selectionSet, root);
  if (cost.result > MAX_RESULT_COST || cost.data > MAX_DATA_WORK) {
    throw limitError('GraphQL operation exceeds the resource budget. Request fewer fields or smaller pages.');
  }
  return cost;
}
