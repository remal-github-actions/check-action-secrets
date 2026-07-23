export interface SecretReference {
    name: string
    line: number
    column: number
    isConditional: boolean
}

export function findSecretReferences(content: string): SecretReference[] {
    const references: SecretReference[] = []
    const substitutionMatches = content.matchAll(/\$\{\{([\s\S]+?)}}/g)
    for (const substitutionMatch of substitutionMatches) {
        const secretMatches = substitutionMatch[1].matchAll(/(?<![\w.-])(!+)?secrets\.([\w-]+)(\s*(?:&&|\|\|))?/g)
        for (const secretMatch of secretMatches) {
            const pos = (substitutionMatch.index || 0) + (secretMatch.index || 0)
            const lines = content.substring(0, pos).split(/\r\n|\n\r|\n|\r/)
            references.push({
                name: secretMatch[2],
                line: lines.length,
                column: lines[lines.length - 1].length,
                isConditional: !!secretMatch[1] || !!secretMatch[3],
            })
        }
    }
    return references
}
