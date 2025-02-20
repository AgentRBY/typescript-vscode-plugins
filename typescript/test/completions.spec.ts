import { pickObj } from '@zardoy/utils'
import type {} from 'vitest/globals'
import { isGoodPositionBuiltinMethodCompletion, isGoodPositionMethodCompletion } from '../src/completions/isGoodPositionMethodCompletion'
import { findChildContainingExactPosition } from '../src/utils'
import handleCommand from '../src/specialCommands/handle'
import _ from 'lodash'
import { defaultConfigFunc, entrypoint, settingsOverride, sharedLanguageService } from './shared'
import { fileContentsSpecialPositions, fourslashLikeTester, getCompletionsAtPosition, overrideSettings } from './testing'
import constructMethodSnippet from '../src/constructMethodSnippet'

const { languageService, languageServiceHost, updateProject, getCurrentFile } = sharedLanguageService

const getSourceFile = () => languageService.getProgram()!.getSourceFile(entrypoint)!
const getNode = (pos: number) => findChildContainingExactPosition(getSourceFile(), pos)

const newFileContents = (contents: string, fileName = entrypoint) => {
    const cursorPositions: number[] = []
    const replacement = '/*|*/'
    let cursorIndex
    while ((cursorIndex = contents.indexOf(replacement)) !== -1) {
        contents = contents.slice(0, cursorIndex) + contents.slice(cursorIndex + replacement.length)
        cursorPositions.push(cursorIndex)
    }
    updateProject({
        [fileName]: contents,
    })
    return cursorPositions
}

test('Banned positions', () => {
    const cursorPositions = newFileContents(/* ts */ `
    import /*|*/ from ''
      import /*|*/ from ''
    const a: {a: 5} = {/*|*/};
    `)
    for (const pos of [cursorPositions[0], cursorPositions[1]]) {
        const result = getCompletionsAtPosition(pos!)
        expect(result).toBeUndefined()
    }
    expect(getCompletionsAtPosition(cursorPositions[2]!)?.entries).toHaveLength(1)
})

test('Banned positions for all method snippets', () => {
    const cursorPositions = newFileContents(/* tsx */ `
        import {/*|*/} from 'test'
        const obj = { m$1e$2thod() {}, arrow: () => {} }
        type A = typeof obj["/*|*/"];
        export {/*|*/} from 'test'
        a(({ a/*|*/ }) => {})
        const test = () => ({ method() {} })
        const {/*|*/} = test()
        const {something, met/*|*/} = test()
        test({
            method/*|*/
        })
        test({
            /*|*/
        })
        ;<Test/*|*/ />
        ;<Test/*|*/></Test>
        ;<Test test={/*|*/}></Test>
        ;<Test test={a/*|*/}></Test>
        ;<Test /*|*/></Test>
        ;<Test a={5} /*|*/ b></Test>
        ;<Test a/*|*/ />
    `)
    for (const [i, pos] of cursorPositions.entries()) {
        const result = isGoodPositionBuiltinMethodCompletion(ts, getSourceFile(), pos - 1, defaultConfigFunc)
        expect(result, i.toString()).toBeFalsy()
    }
    const insertTextEscaping = getCompletionsAtPosition(cursorPositions[1]!)!.entries[1]?.insertText!
    expect(insertTextEscaping).toEqual('m\\$1e\\$2thod')
})

test('Not banned positions for method snippets', () => {
    const cursorPositions = newFileContents(/* ts */ `
        const test = () => ({ method() {} })
        const test2 = () => {}
        test({
            method: /*|*/
        })
        test({
            method: setTimeout/*|*/
        })
        test2/*|*/
    `)
    for (const [i, pos] of cursorPositions.entries()) {
        const result = isGoodPositionMethodCompletion(ts, entrypoint, getSourceFile(), pos - 1, languageService, defaultConfigFunc)
        expect(result, i.toString()).toBeTruthy()
    }
})

test('Function props: cleans & highlights', () => {
    const [pos, pos2] = newFileContents(/* ts */ `
        function fn() {}
        fn./*|*/
        let a: {
            (): void
            sync: 5
        }
        a./*|*/
    `)
    const entryNames = getCompletionsAtPosition(pos!)?.entryNames
    expect(entryNames).not.includes('Symbol')
    const entryNamesHighlighted = getCompletionsAtPosition(pos2!)?.entryNames
    expect(entryNamesHighlighted).includes('☆sync')
})

const compareMethodSnippetAgainstMarker = (inputMarkers: number[], marker: number, expected: string | null | string[]) => {
    const obj = Object.fromEntries(inputMarkers.entries())
    const markerPos = obj[marker]!
    const methodSnippet = constructMethodSnippet(languageService, getSourceFile(), markerPos, defaultConfigFunc)
    const snippetToInsert = methodSnippet ? `(${methodSnippet.join(', ')})` : null
    expect(Array.isArray(expected) ? methodSnippet : snippetToInsert, `At marker ${marker}`).toEqual(expected)
}

describe('Method snippets', () => {
    test('Misc', () => {
        const [, _, markers] = fileContentsSpecialPositions(/* ts */ `
            type A = () => void
            // don't complete for types
            type B = A/*1*/;

            declare const a: A
            a/*2*/

            // overload
            function foo(this: {}, a)
            function foo(this: {}, b)
            function foo(this: {}) {}
            foo/*3*/

            // contextual type
            declare const bar: {
                b: (a) => {}
                c
            } | {
                b: ($b) => {}
                d
            }
            if ('d' in bar) {
                bar.b/*4*/
            }

            // default insert text = binding-name
            declare const baz: {
                (a: string = "test", b?, {
                    d = false,
                    e: {}
                } = {}, ...c): void
            }
            baz/*5*/

            // should ignores comments
            declare const withComments = (
                a: boolean,
                // comment
                b: boolean,
                /* jsdoc */
                c: boolean
            ) => void

            withComments/*6*/
        `)

        compareMethodSnippetAgainstMarker(markers, 1, null)
        compareMethodSnippetAgainstMarker(markers, 2, '()')
        compareMethodSnippetAgainstMarker(markers, 3, '(a)')
        compareMethodSnippetAgainstMarker(markers, 4, '($b)')
        compareMethodSnippetAgainstMarker(markers, 5, '(a, b, { d, e: {} }, ...c)')
        compareMethodSnippetAgainstMarker(markers, 6, '(a, b, c)')
    })

    test('Insert text = always-declaration', () => {
        overrideSettings({
            'methodSnippets.insertText': 'always-declaration',
        })
        const [, _, markers] = fileContentsSpecialPositions(/* ts */ `
            declare const baz: {
                (
                    a: string =
                        "super" +
                        "test",
                    b?, {
                        d = false,
                        e: {}
                    } = { },
                    ...c
                ): void
            }
            baz/*1*/
        `)

        compareMethodSnippetAgainstMarker(markers, 1, '(a = "super" + "test", b?, { d = false, e: {} } = {}, ...c)')
    })

    test('methodSnippets.skip', () => {
        overrideSettings({
            'methodSnippets.skip': 'optional-and-rest',
        })
        const [, _, markers] = fileContentsSpecialPositions(/* ts */ `
            declare const baz: {
                (a: string = "test", b?, {
                    d = false,
                    e: {}
                } = {}, ...c): void
            }
            baz/*1*/
            declare const foo: (a, b?) => void
            foo/*2*/
        `)

        compareMethodSnippetAgainstMarker(markers, 1, [''])
        compareMethodSnippetAgainstMarker(markers, 2, ['a'])
        settingsOverride['methodSnippets.skip'] = 'only-rest'
        compareMethodSnippetAgainstMarker(markers, 1, ['a', 'b', '{ d, e: {} }'])
        settingsOverride['methodSnippets.skip'] = 'all'
        compareMethodSnippetAgainstMarker(markers, 2, [''])
        settingsOverride['methodSnippets.skip'] = 'no-skip'
    })
})

test('Emmet completion', () => {
    const [positivePositions, negativePositions, numPositions] = fileContentsSpecialPositions(/* tsx */ `
    // is it readable enough?
        ;<div>.test/*2*/</div>
        const a = <div d={/*f*/
        /*f*/<div>/*t*/ /*t*/test/*0*/
        /*t*/{}/*t*/ good ul>li/*1*/
        /*t*/</div>} >/*t*/</div>;
        const a = <div >/*t*/
        /*t*/</div>;

        const a = <div>/*t*/</div>
        const a = <div className={/*f*/}>/*t*/</div>
        const a = <span>/*t*/</span>
        const a = <>/*t*/</>
        const a = <React.Fragment/*f*/ key/*f*/>/*t*/</React.Fragment>

        // https://github.com/microsoft/vscode/issues/119736

        ;<style>/*f*/
            .test {
                /*f*/
                di/*f*/
            }
        </style>
        :<style>/*f*/</style>
            `)
    const numPositionsTextLength = {
        0: -4,
        1: -5,
        2: -5,
    }
    const getEmmetCompletions = pos => {
        const result = handleCommand(entrypoint, pos, 'emmet-completions', languageService, defaultConfigFunc, {}, {})
        return result?.typescriptEssentialsResponse?.emmetTextOffset
    }
    for (const [i, pos] of positivePositions.entries()) {
        expect(getEmmetCompletions(pos), i.toString()).toBe(0)
    }
    for (const [i, pos] of Object.entries(numPositions)) {
        expect(getEmmetCompletions(pos), i.toString()).toBe(numPositionsTextLength[i])
    }
    for (const [i, pos] of negativePositions.entries()) {
        expect(getEmmetCompletions(pos), i.toString()).toBeUndefined()
    }
})

test('Array Method Snippets', () => {
    const positions = newFileContents(/*ts*/ `
        const users = []
        users./*|*/
        ;users.filter(Boolean).flatMap/*|*/
    `)
    for (const [i, pos] of positions.entries()) {
        const { entries } = getCompletionsAtPosition(pos) ?? {}
        expect(entries?.find(({ name }) => name === 'flatMap')?.insertText, i.toString()).toBe('flatMap((${2:user}) => $3)')
    }
})

test('String template type completions', () => {
    const tester = fourslashLikeTester(/* ts */ `
        const a: \`v\${'b' | 'c'}.\${number}.\${number}\` = '/*1*/';

        const b: {
            [a: \`foo_\${string}\`]: string
        } = {
            'foo_': '/*2*/'
        }

        const c = (p: typeof b) => { }

        c({
            '/*3*/'
        })

        b['/*4*/']
    `)

    tester.completion(1, {
        exact: {
            names: ['vb.|.|', 'vc.|.|'],
        },
    })

    tester.completion([2, 3, 4], {
        exact: {
            names: ['foo_|'],
        },
    })
})

test('Switch Case Exclude Covered', () => {
    const [, _, numPositions] = fileContentsSpecialPositions(/*ts*/ `
        let test: 'foo' | 'bar'
        switch (test) {
            case 'foo':
                break;
            case '/*|*/':
                break;
            default:
                break;
        }

        enum SomeEnum {
            A,
            B
        }
        let test2: SomeEnum
        switch (test2) {
            case SomeEnum.B:
                break;
            case SomeEnum./*|*/:
                break;
            default:
                break;
        }
    `)
    const completionsByPos = {
        1: ['bar'],
        2: ['A'],
    }
    for (const [i, pos] of Object.entries(numPositions)) {
        const { entryNames } = getCompletionsAtPosition(pos as number) ?? {}
        expect(entryNames).toEqual(completionsByPos[i])
    }
})

test('Case-sensetive completions', () => {
    overrideSettings({
        caseSensitiveCompletions: true,
    })
    const [_positivePositions, _negativePositions, numPositions] = fileContentsSpecialPositions(/* ts */ `
        const a = {
            TestItem: 5,
            testItem: 5,
            '3t': true
            // not sure of these
            // TestItemFoo: 5,
            // TestItemfoo: 5,
        }
        a.t/*0*/
        a['t/*0*/']
    `)
    for (const pos of numPositions) {
        const { entryNames } = getCompletionsAtPosition(pos) ?? {}
        expect(entryNames, pos.toString()).toEqual(['3t', 'testItem'])
    }
    settingsOverride.caseSensitiveCompletions = false
})

test('Fix properties sorting', () => {
    overrideSettings({
        fixSuggestionsSorting: true,
    })
    const tester = fourslashLikeTester(/* tsx */ `
        let a: {
            d
            b(a: {c, a}): {c, a}
        } | {
            c
            b(c: {c, b}): {c, b}
        }
        if ('c' in a) {
            a./*1*/;
            a.b({/*2*/})./*3*/
        }

        declare function MyComponent(props: { b?; c? } & { a? }): JSX.Element
        <MyComponent /*4*/ />;
    `)
    tester.completion(1, {
        exact: {
            names: ['c', 'b'],
        },
    })
    tester.completion([2, 3], {
        exact: {
            names: ['c', 'b'],
        },
    })
    tester.completion(4, {
        exact: {
            names: ['b', 'c', 'a'],
        },
    })
    settingsOverride.fixSuggestionsSorting = false
})

// ts 5
test.todo('Change to function kind', () => {
    settingsOverride['experiments.changeKindToFunction'] = true
    overrideSettings({
        'experiments.changeKindToFunction': true,
    })
    const tester = fourslashLikeTester(/* ts */ `
        // declare const foo: boolean
        const foo = () => {}
        foo/*1*/
    `)
    tester.completion(1, {
        includes: {
            names: ['foo'],
            all: {
                kind: ts.ScriptElementKind.functionElement,
            },
        },
    })
    settingsOverride['experiments.changeKindToFunction'] = false
})

// ts 5
test.todo('Filter JSX Components', () => {
    const tester = fourslashLikeTester(/* ts */ `
        const a = () => {}
        a/*1*/
    `)
})

test('Omit<..., ""> suggestions', () => {
    const tester = fourslashLikeTester(/* ts */ `
      interface A {
          a: string;
          b: number;
      }
      type B = Omit<A, "/*1*/">;
      type B = Omit<A, "a" | "/*2*/">;
    `)
    tester.completion(1, {
        exact: {
            names: ['a', 'b'],
        },
    })
    tester.completion(2, {
        exact: {
            names: ['b'],
        },
    })
})

test('Additional types suggestions', () => {
    const tester = fourslashLikeTester(/* ts */ `
      type A<T /*1*/> = T;
      type A<T extends 'a' | 'b' = '/*2*/'> = T;
    `)
    tester.completion(1, {
        exact: {
            names: ['extends'],
        },
    })
    tester.completion(2, {
        exact: {
            names: ['a', 'b'],
        },
    })
})

test('Object Literal Completions', () => {
    const [_positivePositions, _negativePositions, numPositions] = fileContentsSpecialPositions(/* ts */ `
    interface Options {
        usedOption
        mood?: 'happy' | 'sad'
        callback?()
        additionalOptions?: {
            foo?: boolean
        }
        plugins: Array<{ name: string, setup(build) }>
        undefinedOption: undefined
    }

    const makeDay = (options?: Options) => {}
    makeDay({
        usedOption,
        /*1*/
    })

    const somethingWithUntions: { a: string } | { a: any[], b: string } = {/*2*/}
    `)
    const { entriesSorted: pos1 } = getCompletionsAtPosition(numPositions[1]!)!
    const { entriesSorted: pos2 } = getCompletionsAtPosition(numPositions[2]!)!
    // todo resolve sorting problem + add tests with other keepOriginal (it was tested manually)
    for (const entry of [...pos1, ...pos2]) {
        entry.insertText = entry.insertText?.replaceAll('\n', '\\n')
    }
    expect(pos1).toMatchInlineSnapshot(/* json */ `
      [
        {
          "insertText": "plugins",
          "isSnippet": true,
          "kind": "property",
          "kindModifiers": "",
          "name": "plugins",
        },
        {
          "insertText": "plugins: [\\\\n	$1\\\\n],$0",
          "isSnippet": true,
          "kind": "property",
          "kindModifiers": "",
          "labelDetails": {
            "detail": ": [],",
          },
          "name": "plugins",
        },
        {
          "insertText": "undefinedOption",
          "isSnippet": true,
          "kind": "property",
          "kindModifiers": "",
          "name": "undefinedOption",
        },
        {
          "insertText": "additionalOptions",
          "isSnippet": true,
          "kind": "property",
          "kindModifiers": "optional",
          "name": "additionalOptions",
        },
        {
          "insertText": "additionalOptions: {\\\\n	$1\\\\n},$0",
          "isSnippet": true,
          "kind": "property",
          "kindModifiers": "optional",
          "labelDetails": {
            "detail": ": {},",
          },
          "name": "additionalOptions",
        },
        {
          "insertText": "callback",
          "isSnippet": true,
          "kind": "method",
          "kindModifiers": "optional",
          "name": "callback",
        },
        {
          "insertText": "mood",
          "isSnippet": true,
          "kind": "property",
          "kindModifiers": "optional",
          "name": "mood",
        },
        {
          "insertText": "mood: \\"$1\\",$0",
          "isSnippet": true,
          "kind": "property",
          "kindModifiers": "optional",
          "labelDetails": {
            "detail": ": \\"\\",",
          },
          "name": "mood",
        },
      ]
    `)
    expect(pos2.map(x => x.insertText)).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "b: \\"$1\\",$0",
      ]
    `)
})

test('Extract to type / interface name inference', () => {
    fourslashLikeTester(/* ts */ `
        const foo: { bar: string; } = { bar: 'baz' }
        const foo = { bar: 'baz' } satisfies { bar: 5 }

        const fn = (foo: { bar: 'baz' }, foo = {} as { bar: 'baz' }) => {}

        const obj = { foo: { bar: 'baz' } as { bar: string; } }
    `)
})

test('In Keyword Completions', () => {
    const [pos] = newFileContents(/* ts */ `
        declare const a: { a: boolean, b: string } | { a: number, c: number } | string
        if ('/*|*/' in a) {}
    `)
    const completion = pickObj(getCompletionsAtPosition(pos!, { shouldHave: true })!, 'entriesSorted', 'prevCompletionsMap')
    // this test is bad case of demonstrating how it can be used with string in union (IT SHOULDNT!)
    // but it is here to ensure this is no previous crash issue, indexes are correct when used only with objects
    expect(completion).toMatchInlineSnapshot(`
      {
        "entriesSorted": [
          {
            "insertText": "a",
            "isSnippet": true,
            "kind": "string",
            "labelDetails": {
              "description": "2, 3",
            },
            "name": "a",
            "replacementSpan": {
              "length": 0,
              "start": 101,
            },
          },
          {
            "insertText": "b",
            "isSnippet": true,
            "kind": "string",
            "labelDetails": {
              "description": "2",
            },
            "name": "☆b",
            "replacementSpan": {
              "length": 0,
              "start": 101,
            },
          },
          {
            "insertText": "c",
            "isSnippet": true,
            "kind": "string",
            "labelDetails": {
              "description": "3",
            },
            "name": "☆c",
            "replacementSpan": {
              "length": 0,
              "start": 101,
            },
          },
        ],
        "prevCompletionsMap": {
          "a": {
            "documentationOverride": "2: boolean

      3: number",
          },
          "☆b": {
            "documentationOverride": "2: string",
          },
          "☆c": {
            "documentationOverride": "3: number",
          },
        },
      }
    `)
})
