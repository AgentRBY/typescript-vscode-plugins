import { GetConfig } from '../types'
import { sharedCompletionContext } from './sharedContext'

export default (
    entries: ts.CompletionEntry[],
    node: ts.Node,
    languageService: ts.LanguageService,
    preferences: ts.UserPreferences,
    c: GetConfig,
): ts.CompletionEntry[] | void => {
    const { position } = sharedCompletionContext

    if (entries.length && node) {
        const enableMoreVariants = c('objectLiteralCompletions.moreVariants')
        const keepOriginal = c('objectLiteralCompletions.keepOriginal')
        if (!preferences.includeCompletionsWithObjectLiteralMethodSnippets && !enableMoreVariants) return
        // plans to make it hihgly configurable! e.g. if user wants to make some subtype leading (e.g. from [] | {})
        if (ts.isIdentifier(node)) node = node.parent
        if (ts.isShorthandPropertyAssignment(node)) node = node.parent
        const nextChar = node.getSourceFile().getFullText()[position]
        if (!ts.isObjectLiteralExpression(node) || nextChar === ':') return

        entries = [...entries]
        const typeChecker = languageService.getProgram()!.getTypeChecker()!
        const objType = typeChecker.getContextualType(node)
        if (!objType) return
        const properties = getAllPropertiesOfType(objType, typeChecker)
        for (const property of properties) {
            const entry = entries.find(({ name }) => name === property.name)
            if (!entry) continue
            const type = typeChecker.getTypeOfSymbolAtLocation(property, node)
            if (!type) continue
            if (isFunctionType(type, typeChecker)) {
                if (['above', 'remove'].includes(keepOriginal) && preferences.includeCompletionsWithObjectLiteralMethodSnippets) {
                    const methodEntryIndex = entries.findIndex(e => e.name === entry.name && isObjectLiteralMethodSnippet(e))
                    const methodEntry = entries[methodEntryIndex]
                    if (methodEntry) {
                        entries.splice(methodEntryIndex, 1)
                        entries.splice(entries.indexOf(entry) + (keepOriginal === 'before' ? 1 : 0), keepOriginal === 'remove' ? 1 : 0, {
                            ...methodEntry,
                            // let correctSorting.enable sort it
                            sortText: entry.sortText,
                        })
                    }
                }
                continue
            }
            if (!enableMoreVariants) continue
            const getQuotedSnippet = (): [string, string] => {
                const quote = tsFull.getQuoteFromPreference(tsFull.getQuotePreference(node.getSourceFile() as any, preferences))
                return [`: ${quote}$1${quote},$0`, `: ${quote}${quote},`]
            }
            const insertObjectArrayInnerText = c('objectLiteralCompletions.insertNewLine') ? '\n\t$1\n' : '$1'
            const completingStyleMap = [
                [getQuotedSnippet, isStringCompletion],
                [[': ${1|true,false|},$0', `: true/false,`], isBooleanCompletion],
                [[`: [${insertObjectArrayInnerText}],$0`, `: [],`], isArrayCompletion],
                [[`: {${insertObjectArrayInnerText}},$0`, `: {},`], isObjectCompletion],
            ] as const
            const fallbackSnippet = c('objectLiteralCompletions.fallbackVariant') ? ([': $0,', ': ,'] as const) : undefined
            const insertSnippetVariant = completingStyleMap.find(([, detector]) => detector(type, typeChecker))?.[0] ?? fallbackSnippet
            if (!insertSnippetVariant) continue
            const [insertSnippetText, insertSnippetPreview] = typeof insertSnippetVariant === 'function' ? insertSnippetVariant() : insertSnippetVariant
            const insertText = entry.name + insertSnippetText
            const index = entries.indexOf(entry)
            entries.splice(index + (keepOriginal === 'before' ? 1 : 0), keepOriginal === 'remove' ? 1 : 0, {
                ...entry,
                // todo setting incompatible!!!
                sortText: entry.sortText,
                labelDetails: {
                    detail: insertSnippetPreview,
                },
                insertText,
                isSnippet: true,
            })
        }
        return entries
    }
}

const isObjectLiteralMethodSnippet = (entry: ts.CompletionEntry) => {
    const { detail } = entry.labelDetails ?? {}
    return detail?.startsWith('(') && detail.split('\n')[0]!.trimEnd().endsWith(')')
}

const isFunctionType = (type: ts.Type, checker: ts.TypeChecker) => {
    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) return true
    if (type.isUnion()) return type.types.some(type => isFunctionType(type, checker))
}

const isEverySubtype = (type: ts.UnionType, predicate: (type: ts.Type) => boolean): boolean => {
    // union cannot consist of only undefined types
    return type.types.every(type => {
        if (type.flags & ts.TypeFlags.Undefined) return true
        return predicate(type)
    })
}

const isStringCompletion = (type: ts.Type) => {
    if (type.flags & ts.TypeFlags.Undefined) return false
    if (type.flags & ts.TypeFlags.StringLike) return true
    if (type.isUnion()) return isEverySubtype(type, type => isStringCompletion(type))
    return false
}

const isBooleanCompletion = (type: ts.Type) => {
    if (type.flags & ts.TypeFlags.Undefined) return false
    // todo support boolean literals (boolean like)
    if (type.flags & ts.TypeFlags.Boolean) return true
    if (type.isUnion()) return isEverySubtype(type, type => isBooleanCompletion(type))
    return false
}

const isArrayCompletion = (type: ts.Type, checker: ts.TypeChecker) => {
    if (type.flags & ts.TypeFlags.Any) return false
    if (type.flags & ts.TypeFlags.Undefined) return false
    if (checker['isArrayLikeType'](type)) return true
    if (type.isUnion()) return isEverySubtype(type, type => isArrayCompletion(type, checker))
    return false
}

const isObjectCompletion = (type: ts.Type, checker: ts.TypeChecker) => {
    if (type.flags & ts.TypeFlags.Undefined) return false
    if (checker['isArrayLikeType'](type)) return false
    if (type.flags & ts.TypeFlags.Object) {
        if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Class) return false
        // complete with regexp?
        if (type.symbol?.escapedName === 'RegExp') return false
        return true
    }
    if (type.isUnion()) return isEverySubtype(type, type => isObjectCompletion(type, checker))
    return false
}

export const getAllPropertiesOfType = (type: ts.Type, typeChecker: ts.TypeChecker) => {
    const types = type.isUnion() ? type.types : [type]
    let objectCount = 0
    const properties = types
        .flatMap(type => {
            if (isFunctionType(type, typeChecker)) return []
            if (isObjectCompletion(type, typeChecker)) {
                objectCount++
                return typeChecker.getPropertiesOfType(type)
            }
            return []
        })
        .filter((property, i, arr) => {
            // perf
            if (objectCount === 1) return true
            return !arr.find(({ name }, k) => name === property.name && i !== k)
        })
    return properties
}
