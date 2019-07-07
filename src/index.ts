import {
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLString,
    SelectionSetNode,
    FieldNode,
    FragmentSpreadNode,
    InlineFragmentNode,
    GraphQLDirective,
    DirectiveNode,
    GraphQLIncludeDirective,
    GraphQLSkipDirective,
    GraphQLType,
    OperationDefinitionNode,
    GraphQLOutputType,
    GraphQLCompositeType,
    GraphQLInterfaceType,
    GraphQLUnionType,
    parse,
    GraphQLField,
    getNamedType,
    isCompositeType,
    FragmentDefinitionNode,
    DocumentNode,
    VariableDefinitionNode
} from 'graphql';
import { getArgumentValues, getVariableValues } from 'graphql/execution/values';
import * as util from 'util';
import { restElement } from '@babel/types';
import { buildExecutionContext } from 'graphql/execution/execute';

interface ExecutionContext {
    schema: GraphQLSchema;
    fragments: { [key: string]: FragmentDefinitionNode };
    variableValues: { [key: string]: any };
}

export interface FieldVertex {
    id: string,
    fields: Array<FieldNode>;
    objectType: GraphQLObjectType;
    fieldDefinition: GraphQLField<any, any>;
    dependsOn: Array<FieldVertex>;
    dependOnMe: Array<FieldVertex>;
}



interface MergedFieldWithType {
    fields: Array<FieldNode>;
    objectType: GraphQLObjectType;
    fieldDefinition: GraphQLField<any, any>;
}

export interface DependencyEdge {
    from: FieldVertex,
    to: FieldVertex
}

export function printDependencyGraph(root: FieldVertex):
    [Array<FieldVertex>, Array<DependencyEdge>] {

    const allVertices: Array<FieldVertex> = [];
    const edges: Array<DependencyEdge> = [];
    traverseFieldVertices(root, vertex => {
        allVertices.push(vertex);
        for (const dependOnMe of vertex.dependOnMe) {
            edges.push({ from: dependOnMe, to: vertex });
        }
    });
    return [allVertices, edges];

}

export function traverseFieldVertices(
    root: FieldVertex,
    visitor: (vertex: FieldVertex) => void): void {
    const traverserState: Array<FieldVertex> = [];
    traverserState.push(root);

    while (traverserState.length > 0) {
        const curVertex = traverserState.pop()!;
        visitor(curVertex);
        const children = curVertex.dependOnMe;

        children.forEach(child => {
            traverserState.push(child);
        });
    }
}

export function analyzeQuery(
    document: DocumentNode,
    schema: GraphQLSchema,
    rawVariableValues?: { [key: string]: any },
): FieldVertex {
    const operationDefinition = getOperationDefinition(document);
    const variableDefinitions = (operationDefinition.variableDefinitions as Array<VariableDefinitionNode>)
        || [];
    const coercedVariableValues = getVariableValues(
        schema,
        variableDefinitions,
        rawVariableValues || {},
    );

    const fragments = getFragments(document);
    const context: ExecutionContext = {
        fragments,
        schema,
        variableValues: coercedVariableValues
    };
    const roots = collectFieldsFromOperation(
        context,
        operationDefinition,
        schema.getQueryType()!
    )

    const getChildren: (mergedField: MergedFieldWithType) => Array<MergedFieldWithType> = mergedField => {
        return collectFields(
            context,
            mergedField
        )
    };

    const dummyRootFieldVertex: FieldVertex & Object = {
        id: "0",
        objectType: null!,
        fields: null!,
        dependOnMe: [],
        dependsOn: [],
        fieldDefinition: null!,
        toString() {
            return "ROOT";
        }
    };
    const allVertices: Array<FieldVertex> = [];
    let vertexId = 1;
    const visitor = (context: VisitorContext) => {
        const mergedField = context.mergedField;

        const newFieldVertex: FieldVertex & Object = {
            id: (vertexId++).toString(),
            fields: mergedField.fields,
            objectType: mergedField.objectType,
            fieldDefinition: mergedField.fieldDefinition,
            dependsOn: [context.parentContext!.fieldVertex!],
            dependOnMe: [],
            toString() {
                return this.objectType.name + "." + this.fields[0].name.value + ": " + 
                    this.fieldDefinition.type;
            }
        };
        context.parentContext.fieldVertex!.dependOnMe.push(newFieldVertex);
        context.fieldVertex = newFieldVertex;
        allVertices.push(newFieldVertex);
    };
    depthFirstVisit(roots, dummyRootFieldVertex, getChildren, visitor);

    return dummyRootFieldVertex;
}

interface VisitorContext {
    mergedField: MergedFieldWithType;
    fieldVertex?: FieldVertex;
    parentContext: VisitorContext;
}


function mergedFieldToString(mergedField: MergedFieldWithType): string {
    if (!mergedField) {
        return "merged field null";
    }
    return mergedField.objectType.name + "." + getFieldEntryKey(mergedField.fields[0]);
}

function vertexToString(fieldVertex: FieldVertex): string {
    if (!fieldVertex.objectType) {
        return "ROOT VERTEX";
    }
    return fieldVertex.objectType.name + "." + getFieldEntryKey(fieldVertex.fields[0]) +
        " -> " + fieldVertex.dependsOn.map(dependency => vertexToString(dependency));
}


function depthFirstVisit(
    roots: Array<MergedFieldWithType>,
    rootFieldVertex: FieldVertex,
    getChildren: (mergedField: MergedFieldWithType) => Array<MergedFieldWithType>,
    visitor: (context: VisitorContext) => void) {
    const traverserState: Array<VisitorContext> = [];
    const dummyRootContext: VisitorContext = {
        mergedField: null!,
        fieldVertex: rootFieldVertex,
        parentContext: null!
    };
    roots.forEach(mergedField => {
        traverserState.push({ mergedField, fieldVertex: rootFieldVertex, parentContext: dummyRootContext });
    });

    while (traverserState.length > 0) {
        const curContext = traverserState.pop()!;
        visitor(curContext);
        const children = getChildren(curContext.mergedField);

        children.forEach(child => {
            const newContext = {
                parentContext: curContext,
                mergedField: child,
            };
            traverserState.push(newContext);
        });
    }
}


function collectFieldsFromOperation(
    exeContext: ExecutionContext,
    operationDefinition: OperationDefinitionNode,
    rootType: GraphQLObjectType
): Array<MergedFieldWithType> {

    const result: { [key: string]: { [type: string]: MergedFieldWithType } } = {};
    collectFieldsImpl(exeContext, operationDefinition.selectionSet, result, new Set([rootType]), {}, rootType);
    return toListOfMergedFields(result);
}

function collectFields(
    exeContext: ExecutionContext,
    mergedField: MergedFieldWithType
): Array<MergedFieldWithType> {

    const result: { [key: string]: { [type: string]: MergedFieldWithType } } = {};
    const parentType = getNamedType(mergedField.fieldDefinition.type);
    if (!(isCompositeType(parentType))) {
        return [];
    }
    const possibleTypes = getPossibleTypes(exeContext, parentType);
    for (const field of mergedField.fields) {
        collectFieldsImpl(exeContext,
            field.selectionSet!,
            result,
            possibleTypes,
            {},
            parentType);

    }
    return toListOfMergedFields(result);
}

function toListOfMergedFields(map: { [key: string]: { [type: string]: MergedFieldWithType } }): Array<MergedFieldWithType> {
    const mergedFields: Array<MergedFieldWithType> = [];
    const listOfMaps = Object.values(map);
    listOfMaps.forEach(mapByTypeName => Object.values(mapByTypeName).forEach(mergedField => {
        mergedFields.push(mergedField);
    }));
    return mergedFields;
}





function collectFieldsImpl(
    exeContext: ExecutionContext,
    selectionSet: SelectionSetNode,
    result: { [key: string]: { [type: string]: MergedFieldWithType } },
    possibleObjectTypes: Set<GraphQLObjectType>,
    visitedFragmentNames: { [k: string]: boolean },
    parentType: GraphQLOutputType
) {

    for (let i = 0; i < selectionSet.selections.length; i++) {
        const selection = selectionSet.selections[i];
        switch (selection.kind) {
            case "Field": {
                collectField(exeContext, selection, result, possibleObjectTypes, visitedFragmentNames, parentType);
                break;
            }
            case "InlineFragment": {
                collectInlineFragment(exeContext, selection, result, possibleObjectTypes, visitedFragmentNames, parentType);
                break;
            }
            case "FragmentSpread": {
                collectFragmentSpread(exeContext, selection, result, possibleObjectTypes, visitedFragmentNames, parentType);
                break;

            }
        }
    }
}

function collectField(
    exeContext: ExecutionContext,
    field: FieldNode,
    result: { [key: string]: { [type: string]: MergedFieldWithType } },
    possibleObjectTypes: Set<GraphQLObjectType>,
    visitedFragmentNames: { [k: string]: boolean },
    parentType: GraphQLOutputType
) {
    if (!shouldIncludeNode(exeContext, field)) {
        return;
    }
    const name = getFieldEntryKey(field);
    if (!result[name]) {
        result[name] = {}
    }
    const mergedFields = result[name];
    for (const possibleObject of possibleObjectTypes) {
        if (!mergedFields[possibleObject.name]) {

            const unwrappedParentType = getNamedType(parentType) as (GraphQLObjectType | GraphQLInterfaceType);
            const fieldDefinition = unwrappedParentType.getFields()[field.name.value];
            const newMergedField: MergedFieldWithType = {
                fields: [field],
                objectType: possibleObject,
                fieldDefinition
            };
            mergedFields[possibleObject.name] = newMergedField;
        } else {
            const existingMergedField = mergedFields[possibleObject.name];
            existingMergedField.fields.push(field);
        }
    }

}
function collectInlineFragment(
    exeContext: ExecutionContext,
    inlineFragment: InlineFragmentNode,
    result: { [key: string]: { [type: string]: MergedFieldWithType } },
    possibleObjectTypes: Set<GraphQLObjectType>,
    visitedFragmentNames: { [k: string]: boolean },
    parentType: GraphQLOutputType) {

    if (!shouldIncludeNode(exeContext, inlineFragment)) {
        return;
    }
    let newPossibleObjectTypes = possibleObjectTypes;
    let newParentType = parentType;
    if (inlineFragment.typeCondition) {
        newParentType = nonNull(exeContext.schema.getType(inlineFragment.typeCondition.name.value)) as GraphQLObjectType;
        newPossibleObjectTypes = narrowDownPossibleObjects(exeContext, possibleObjectTypes, newParentType);;
    }
    collectFieldsImpl(
        exeContext,
        inlineFragment.selectionSet,
        result,
        newPossibleObjectTypes,
        visitedFragmentNames,
        newParentType
    );

}
function collectFragmentSpread(
    exeContext: ExecutionContext,
    fragmentSpread: FragmentSpreadNode,
    result: { [key: string]: { [type: string]: MergedFieldWithType } },
    possibleObjectTypes: Set<GraphQLObjectType>,
    visitedFragmentNames: { [k: string]: boolean },
    parentType: GraphQLOutputType) {

    const fragName = fragmentSpread.name.value;
    if (visitedFragmentNames[fragName] || !shouldIncludeNode(exeContext, fragmentSpread)) {
        return;
    }
    visitedFragmentNames[fragName] = true;
    const fragment = exeContext.fragments[fragName];

    const newParentType = exeContext.schema.getType(fragment.typeCondition.name.value) as GraphQLObjectType;
    const newPossibleObjectTypes = narrowDownPossibleObjects(exeContext, possibleObjectTypes, newParentType);;
    collectFieldsImpl(
        exeContext,
        fragment.selectionSet,
        result,
        newPossibleObjectTypes,
        visitedFragmentNames,
        newParentType
    );
}

function narrowDownPossibleObjects(
    exeContext: ExecutionContext,
    currentObjects: Set<GraphQLObjectType>,
    newCondition: GraphQLCompositeType
): Set<GraphQLObjectType> {
    const resolvedObjects = getPossibleTypes(exeContext, newCondition);
    if (currentObjects.size == 0) {
        return new Set(resolvedObjects);
    }
    const result = new Set<GraphQLObjectType>();
    for (const object of currentObjects) {
        if (resolvedObjects.has(object)) {
            result.add(object);
        }
    }
    return result;
}
function getPossibleTypes(
    exeContext: ExecutionContext,
    type: GraphQLCompositeType)
    : Set<GraphQLObjectType> {

    if (type instanceof GraphQLObjectType) {
        return new Set([type]);
    } else if (type instanceof GraphQLInterfaceType || type instanceof GraphQLUnionType) {
        return new Set(exeContext.schema.getPossibleTypes(type));
    } else {
        throw new Error(`should not happen: type is ${type}`);
    }
}

function getFragments(document: DocumentNode): { [k: string]: FragmentDefinitionNode } {

    const fragments: { [k: string]: FragmentDefinitionNode } = {};
    for (let i = 0; i < document.definitions.length; i++) {
        const definition = document.definitions[i];
        switch (definition.kind) {
            case "FragmentDefinition":
                fragments[definition.name.value] = definition;
                break;
        }
    }
    return fragments;
}
function getOperationDefinition(document: DocumentNode): OperationDefinitionNode {

    let result: OperationDefinitionNode | null = null;
    for (let i = 0; i < document.definitions.length; i++) {
        const definition = document.definitions[i];
        switch (definition.kind) {
            case "OperationDefinition":
                if (result != null) {
                    throw new Error("more than one operation found");
                }
                result = definition;
                break;
        }
    }
    if (result) {
        return result;
    } else {
        throw new Error("no operation found");
    }

}


function getFieldEntryKey(node: FieldNode): string {
    return node.alias ? node.alias.value : node.name.value;
}


function shouldIncludeNode(
    exeContext: ExecutionContext,
    node: FragmentSpreadNode | FieldNode | InlineFragmentNode,
): boolean {
    const skip = getDirectiveValues(
        GraphQLSkipDirective,
        node,
        exeContext.variableValues,
    );
    if (skip && skip.if === true) {
        return false;
    }

    const include = getDirectiveValues(
        GraphQLIncludeDirective,
        node,
        exeContext.variableValues,
    );
    if (include && include.if === false) {
        return false;
    }
    return true;
}

function getDirectiveValues(
    directiveDef: GraphQLDirective,
    node: { directives?: ReadonlyArray<DirectiveNode> },
    variableValues: { [k: string]: any }
): void | { [argument: string]: any } {

    const directiveNode =
        node.directives &&
        node.directives.find(
            directive => directive.name.value === directiveDef.name,
        );

    if (directiveNode) {
        return getArgumentValues(directiveDef, directiveNode, variableValues);
    }
}

function invariant(condition: any, message: string) {
    const booleanCondition = Boolean(condition);
    if (!booleanCondition) {
        throw new Error(message);
    }
}
function nonNull<T>(object: T): T {
    if (!object) {
        throw new Error('expected non null/undefined');
    }
    return object;
}

