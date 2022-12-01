import * as vscode from 'vscode'

export const tsRangeToVscode = (document: vscode.TextDocument, [start, end]: [number, number]) =>
    new vscode.Range(document.positionAt(start), document.positionAt(end))

export const tsRangeToVscodeSelection = (document: vscode.TextDocument, [start, end]: [number, number]) =>
    new vscode.Selection(document.positionAt(start), document.positionAt(end))
