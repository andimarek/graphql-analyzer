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
        animals: [Animal]
    }
    interface Animal{
        name: String
    }
    type Dog implements Animal{
        name: String
        id: ID
    }
    type Cat implements Animal{
        name: String
    }
    `)

    it('simple query', () => {
        const query = `
        { 
            dog {
                name
            }
        }`;
        const document = parse(query);
        const rootVertex = analyzeQuery(document, schema);
        const [allVertices, allEdges] = printDependencyGraph(rootVertex);
        expect(allEdges).to.be.lengthOf(2);
        const edgesString = allEdges.map(edge => edge.from.toString() + ' -> ' + edge.to.toString());
        expect(edgesString).to.contain('Query.dog: Dog -> ROOT');
        expect(edgesString).to.contain('Dog.name: String -> Query.dog: Dog');
        console.log(edgesString);
    });
    it('fragments on interface', () => {
        const query = `
        { 
            animals {
                ... on Dog {
                    name
                }
                ... on Cat {
                    name
                }
            }
        }`;
        const document = parse(query);
        const rootVertex = analyzeQuery(document, schema);
        const [allVertices, allEdges] = printDependencyGraph(rootVertex);
        expect(allEdges).to.be.lengthOf(3);
        const edgesString = allEdges.map(edge => edge.from.toString() + ' -> ' + edge.to.toString());
        console.log(edgesString);
        expect(edgesString).to.contain('Query.animals: [Animal] -> ROOT');
        expect(edgesString).to.contain('Dog.name: String -> Query.animals: [Animal]');
        expect(edgesString).to.contain('Cat.name: String -> Query.animals: [Animal]');

    });

})

