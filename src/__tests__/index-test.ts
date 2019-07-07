import { expect } from 'chai';
import { parse, OperationDefinitionNode, buildSchema } from 'graphql';
import { ExecutionContext } from 'graphql/execution/execute';

import { analyzeQuery, traverseFieldVertices, printDependencyGraph } from '../index';
import * as util from 'util';

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
        }
    }`;
    const document = parse(query);

    it('test', () => {
        const rootVertex = analyzeQuery(document, schema);
        const [allVertices, allEdges] = printDependencyGraph(rootVertex);
        expect(allEdges.length == 3);
        const edgesString = allEdges.map(edge => edge.from.toString() + ' -> ' + edge.to.toString());
        expect(edgesString).to.contain('Query.dog: Dog -> ROOT');
        expect(edgesString).to.contain( 'Dog.name: String -> Query.dog: Dog');
        console.log(edgesString);
    });

})

