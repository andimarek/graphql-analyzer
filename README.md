# GraphQL analyzer

Static analysis of GraphQL queries (analysis without actually executing the query).

Please see this blog post for background and details: [Static analysis of GraphQL queries
](https://www.graphql.de/blog/static-query-analysis/)

# Usage

Add to your project:

```sh
npm install graphql-analyzer
```

`graphql-analyzer` exports three functions:

```typescript
import {analyzeQuery, printDependencyGraph, traverseFieldVertices } from 'graphql-analyzer';
```

`analyseQuery` returns a the root `FieldVertex` of the dependency graph.

Details:
```typescript
export interface FieldVertex {
    id: string;
    fields: Array<FieldNode>;
    objectType: GraphQLObjectType;
    fieldDefinition: GraphQLField<any, any>;
    dependsOn: Array<FieldVertex>;
    dependOnMe: Array<FieldVertex>;
}
export function analyzeQuery(
    document: DocumentNode, 
    schema: GraphQLSchema, 
    rawVariableValues?: { [key: string]: any; }, 
    validateQuery?: boolean)
    : FieldVertex;
```

`printDependencyGraph` returns all vertices and all edges for a dependency graph:

```typescript
export interface DependencyEdge {
    from: FieldVertex;
    to: FieldVertex;
    conditional: boolean;
}
export function printDependencyGraph(
    root: FieldVertex)
    : [Array<FieldVertex>, Array<DependencyEdge>];
```

`traverseFieldVertices` lets you traverse the graph returned by `analyzeQuery`:

```typescript
export function traverseFieldVertices(
    root: FieldVertex, 
    visitor: (vertex: FieldVertex) => void)
    : void;
```







