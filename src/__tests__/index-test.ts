import { expect } from 'chai';
import { parse, OperationDefinitionNode, buildSchema } from 'graphql';
import { ExecutionContext } from 'graphql/execution/execute';

import { collectFieldsFromOperation, analyzeQuery } from '../index';
import * as util from 'util';

describe('collectFields', () => {
    const schema = buildSchema(`
    type Query {
        hello: String
    }`)
    const query = '{ hello hello2: hello ...on Query { hello } }';
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

    it('collectFieldsFromRoot', () => {
        const mergedFields = collectFieldsFromOperation(executionContext, operationDefinition, schema.getQueryType()!);
        expect(mergedFields.length).equal(2);
    });
});

describe('analyze', () => {
    const schema = buildSchema(`
    type Query {
        dog: Dog  
        cat: Cat
    }
    type Dog {
        name: String
        id: ID
    }
    type Cat {
        name: String
    }
    `)
    const query = `
    { 
        dog {
            name
            name
            ... on Dog {
                name
            }
            id
        }
        cat {
            name
        }
    }`;
    const document = parse(query);


    it('test', () => {
        analyzeQuery(document, schema);
    });

})

