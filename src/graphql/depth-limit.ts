import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
} from 'graphql';

// Depth counts field nesting: a root field is depth 1 and every nested
// selection set adds one. Fragments (named or inline) add no depth of their
// own. The deepest in-repo operation is 5, the Feed queries in
// src/hooks/api.ts and home-feed.tsx (articles > edges > node > author >
// handle). The limit is that plus two levels of headroom.
export const MAX_QUERY_DEPTH = 7;

// Introspection is enabled outside production, and its query nests far
// deeper than any app query. Its fields resolve from the schema, not the
// database, so they are not counted.
const INTROSPECTION_ROOTS = new Set(['__schema', '__type']);

export function depthLimit(maxDepth: number): ValidationRule {
  return (context: ValidationContext): ASTVisitor => {
    // Fragment depth doesn't depend on where it is spread, so each fragment
    // is measured once. A fragment in progress is a cycle, which graphql-js's
    // NoFragmentCyclesRule reports; count it as 0 here so the walk ends.
    const fragmentDepths = new Map<string, number>();
    const inProgress = new Set<string>();

    function selectionDepth(selectionSet: SelectionSetNode): number {
      let deepest = 0;
      for (const selection of selectionSet.selections) {
        let depth = 0;
        if (selection.kind === Kind.FIELD) {
          if (INTROSPECTION_ROOTS.has(selection.name.value)) continue;
          depth = 1 + (selection.selectionSet ? selectionDepth(selection.selectionSet) : 0);
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          depth = selectionDepth(selection.selectionSet);
        } else {
          depth = fragmentDepth(selection.name.value);
        }
        deepest = Math.max(deepest, depth);
      }
      return deepest;
    }

    function fragmentDepth(name: string): number {
      const known = fragmentDepths.get(name);
      if (known !== undefined) return known;
      if (inProgress.has(name)) return 0;
      // Unknown fragments are reported by KnownFragmentNamesRule.
      const fragment = context.getFragment(name);
      if (!fragment) return 0;
      inProgress.add(name);
      const depth = selectionDepth(fragment.selectionSet);
      inProgress.delete(name);
      fragmentDepths.set(name, depth);
      return depth;
    }

    return {
      OperationDefinition(node) {
        const depth = selectionDepth(node.selectionSet);
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(`Query depth ${depth} exceeds the maximum of ${maxDepth}.`, { nodes: [node] }),
          );
        }
      },
    };
  };
}
