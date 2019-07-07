import {
    graphql,
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLString,
    parse,
    visit,
    ASTNode,
    SelectionSetNode,
    FieldNode,
    FragmentSpreadNode,
    InlineFragmentNode,
    GraphQLDirective,
    DirectiveNode,
    GraphQLError,
    GraphQLField,
    GraphQLNonNull,
    GraphQLIncludeDirective,
    GraphQLSkipDirective,
    valueFromAST,
    GraphQLType,
    OperationDefinitionNode,
    GraphQLOutputType,
    createSourceEventStream,
    GraphQLNamedType,
    GraphQLCompositeType,
    GraphQLInterfaceType,
    GraphQLUnionType
} from 'graphql';
import { ExecutionContext } from 'graphql/execution/execute';
import { getArgumentValues } from 'graphql/execution/values';
import * as util from 'util';

interface MergedFieldWithType {
    fields: Array<FieldNode>,
    objectType: GraphQLObjectType,
    // fieldDefinition: GraphQLField,
}


function collectFieldsFromRoot(
    exeContext: ExecutionContext,
    operationDefinition: OperationDefinitionNode,
    rootType: GraphQLObjectType
): Array<MergedFieldWithType> {

    const result: { [key: string]: { [type: string]: MergedFieldWithType } } = {};
    collectFieldsImpl(exeContext, operationDefinition.selectionSet, result, new Set([rootType]), {}, rootType);

    const mergedFields: Array<MergedFieldWithType> = [];
    const listOfMaps = Object.values(result);
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
            const newMergedField: MergedFieldWithType = {
                fields: [field],
                objectType: possibleObject
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
        newParentType = exeContext.schema.getType(inlineFragment.typeCondition.name.value) as GraphQLObjectType;
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
        throw new Error("should not happen");
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
type StringRecord<T = any> = Record<string, T>;

function keyMap<T>(
    list: ReadonlyArray<T>,
    keyFn: (item: T) => string,
): StringRecord<T> {
    return list.reduce((map, item) => {
        map[keyFn(item)] = item;
        return map;
    }, Object.create(null));
}


function hasOwnProperty(obj: any, prop: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

function invariant(condition: any, message: string) {
    const booleanCondition = Boolean(condition);
    if (!booleanCondition) {
        throw new Error(message);
    }
}

function inspect(value: any): string {
    return String(value);
}

function print(value: any): string {
    return String(value);
}

function isNonNullType(type: any): boolean {
    return type instanceof GraphQLNonNull;
}


interface FieldVertex {
    field: FieldNode;
    objectType: Array<GraphQLType>;
}

// ----------------------------------------
// ----------------------------------------
// ----------------------------------------

var schema = new GraphQLSchema({
    query: new GraphQLObjectType({
        name: 'RootQueryType',
        fields: {
            hello: {
                type: GraphQLString,
                resolve() {
                    return 'world';
                }
            }
        }
    })
});
var query = '{ hello hello2: hello ...on RootQueryType { hello } }';
const ast = parse(query);

const operationDefinition: OperationDefinitionNode = ast.definitions[0] as OperationDefinitionNode;
const selectionSet = operationDefinition.selectionSet;
const executionContext: ExecutionContext = {
    schema,
    fragments: {},
    rootValue: null,
    contextValue: null,
    operation: operationDefinition,
    variableValues: {},
    fieldResolver: null!,
    errors: []
};
const mergedFields = collectFieldsFromRoot(executionContext, operationDefinition, schema.getQueryType()!);
console.log('result:', util.inspect(mergedFields, false, null, true));

// graphql(schema, query).then(result => {

//     // Prints
//     // {
//     //   data: { hello: "world" }
//     // }
//     console.log(result);

// });
