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
        pets: [CatOrDog]
    }
    union CatOrDog = Cat | Dog

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
    it('inline fragments on interface', () => {
        const query = `
        { 
            animals {
                name
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
        expect(allEdges).to.be.lengthOf(3)
        const edgesString = allEdges.map(edge => edge.from.toString() + ' -> ' + edge.to.toString());
        console.log(edgesString);
        expect(edgesString).to.contain('Query.animals: [Animal] -> ROOT');
        expect(edgesString).to.contain('Dog.name: String -> Query.animals: [Animal]');
        expect(edgesString).to.contain('Cat.name: String -> Query.animals: [Animal]');

    });
    it('fragment on interface', () => {
        const query = `
        { 
            animals {
                ...OnCat
            }
        }
        fragment OnCat on Cat{
            name
        }`;
        const document = parse(query);
        const rootVertex = analyzeQuery(document, schema);
        const [allVertices, allEdges] = printDependencyGraph(rootVertex);
        expect(allEdges).to.be.lengthOf(2)
        const edgesString = allEdges.map(edge => edge.from.toString() + ' -> ' + edge.to.toString());
        console.log(edgesString);
        expect(edgesString).to.contain('Query.animals: [Animal] -> ROOT');
        expect(edgesString).to.contain('Cat.name: String -> Query.animals: [Animal]');

    });

    it('field on interface', () => {
        const query = `
        { 
            animals {
                name
            }
        }`;
        const document = parse(query);
        const rootVertex = analyzeQuery(document, schema);
        const [allVertices, allEdges] = printDependencyGraph(rootVertex);
        expect(allEdges).to.be.lengthOf(3)
        const edgesString = allEdges.map(edge => edge.from.toString() + ' -> ' + edge.to.toString());
        console.log(edgesString);
        expect(edgesString).to.contain('Query.animals: [Animal] -> ROOT');
        expect(edgesString).to.contain('Dog.name: String -> Query.animals: [Animal]');
        expect(edgesString).to.contain('Cat.name: String -> Query.animals: [Animal]');

    });

    it('validation fails', () => {
        const query = `
        { 
            animals {
                illegalField
            }
        }`;
        const document = parse(query);
        expect(() => analyzeQuery(document, schema )).to.be.throw();

    });


    it('__typename is ignored', () => {
        const query = `
        { 
            animals {
                __typename
            }
            pets {
                __typename
            }
        }`;
        const document = parse(query);
        const rootVertex = analyzeQuery(document, schema);
        const [allVertices, allEdges] = printDependencyGraph(rootVertex);
        expect(allEdges).to.be.lengthOf(2);
        const edgesString = allEdges.map(edge => edge.from.toString() + ' -> ' + edge.to.toString());
        console.log(edgesString);
        expect(edgesString).to.contain('Query.animals: [Animal] -> ROOT');
        expect(edgesString).to.contain('Query.pets: [CatOrDog] -> ROOT');

    });

})

